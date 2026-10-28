import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withModel } from '../llm/llm';
import type { CenterConfig } from './config';
import type { LogService } from './logs';
import type { ModelInfo } from '@protocol';
import { childEnv, sanitizeText } from './sanitize';

// Pi CLI como proceso hijo, sólo para tareas de redacción (explicar una ejecución). Nunca recibe
// herramientas: sin bash, sin archivos, sin extensiones, sin MCP, sin sesión guardada, sin red
// (salvo el runtime local del modelo). Se lanza sin shell, con argumentos en arreglo.
// Lo que se ve en la consola es lo que Pi escribe de verdad: los eventos JSONL de stdout
// (--mode json) y las líneas de stderr, sanitizados.

export const PI_SAFE_ARGS = [
  '--mode',
  'json',
  '--no-tools',
  '--no-session',
  '--no-extensions',
  '--no-mcp',
  '--no-skills',
  '--no-prompt-templates',
  '--no-context-files',
  '--no-themes',
  '--no-approve',
  '--offline',
];

const SYSTEM =
  'Explicas en español, en 3 a 6 frases claras, el resultado de un proceso automático que clasifica rutas de transporte público de Morelos. ' +
  'Usa sólo los datos que se te dan; no inventes cifras, lugares ni causas. Si algo requiere revisión, di qué y por qué. /no_think';

export interface PiResult {
  texto: string;
  ms: number;
  codigo: number | null;
  ok: boolean;
  /** Pi terminó porque llegó al límite de longitud (la respuesta puede estar cortada). */
  cortado: boolean;
  uso?: Record<string, unknown>;
}

export class PiService {
  private enCurso: { jobId: string; desde: string; pid?: number; child: ChildProcess } | null = null;
  private ultima: ModelInfo['pi']['ultima'] = null;

  constructor(
    private readonly cfg: CenterConfig['pi'],
    private readonly modelo: string,
    private readonly logs: LogService,
    private readonly workDir: string,
  ) {}

  version(): string | undefined {
    try {
      const f = join(dirname(this.cfg.launcher), '..', 'install', 'current-version');
      return existsSync(f) ? readFileSync(f, 'utf8').trim() : undefined;
    } catch {
      return undefined;
    }
  }

  status(): ModelInfo['pi'] {
    const ok = this.cfg.habilitado && existsSync(this.cfg.node) && existsSync(this.cfg.launcher);
    return {
      disponible: ok,
      detalle: !this.cfg.habilitado
        ? 'deshabilitado en la configuración'
        : ok
          ? `Pi ${this.version() ?? ''} con ${this.modelo} (Ollama). El orquestador no lo usa: llama a Qwen directo; Pi se usa para explicar ejecuciones.`
          : 'no se encontró Pi (pi-launcher.js o su node.exe)',
      version: this.version(),
      enCurso: this.enCurso ? { jobId: this.enCurso.jobId, desde: this.enCurso.desde, pid: this.enCurso.pid } : null,
      ultima: this.ultima,
    };
  }

  get busy() {
    return !!this.enCurso;
  }

  cancel() {
    this.enCurso?.child?.kill();
  }

  /** Corre Pi con un prompt; `onText` recibe el texto a medida que Pi lo emite (streaming real). */
  run(jobId: string, prompt: string, onText: (t: string) => void): Promise<PiResult> {
    if (this.enCurso) return Promise.reject(new Error(`Pi ya está trabajando (ejecución ${this.enCurso.jobId})`));
    const st = this.status();
    if (!st.disponible) return Promise.reject(new Error(`Pi no está disponible: ${st.detalle}`));
    const log = (nivel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', mensaje: string, extra: { duracionMs?: number; datos?: Record<string, unknown> } = {}) =>
      this.logs.add({ nivel, componente: 'PI-CLI', mensaje, jobId, ...extra });
    // reservado antes de esperar al modelo: dos "explicar" seguidos no lanzan dos procesos
    this.enCurso = { jobId, desde: new Date().toISOString(), child: null as unknown as ChildProcess };
    log('INFO', 'En espera del modelo (lo comparte con el orquestador y el chat)');

    return withModel(
      { origen: 'pi', tarea: `Pi: explicar la ejecución ${jobId}`, modelo: this.modelo },
      () => this.spawnPi(jobId, prompt, onText, log),
      (r) => ({ ok: r.ok, detalle: r.ok ? undefined : `código ${r.codigo}` }),
    ).finally(() => {
      this.enCurso = null;
    });
  }

  private spawnPi(
    jobId: string,
    prompt: string,
    onText: (t: string) => void,
    log: (n: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', m: string, x?: { duracionMs?: number; datos?: Record<string, unknown> }) => void,
  ): Promise<PiResult> {
    mkdirSync(this.workDir, { recursive: true });
    const args = [
      this.cfg.launcher,
      ...PI_SAFE_ARGS,
      '--provider',
      'ollama',
      '--model',
      this.modelo,
      '--thinking',
      'off',
      '--system-prompt',
      SYSTEM,
      '--',
      prompt.slice(0, 6000),
    ];
    const t0 = Date.now();
    const child = spawn(this.cfg.node, args, {
      cwd: this.workDir,
      env: childEnv({ PI_OFFLINE: '1' }),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.enCurso = { jobId, desde: new Date().toISOString(), pid: child.pid, child };
    log('INFO', `Proceso iniciado (pid ${child.pid}): pi ${PI_SAFE_ARGS.join(' ')} --model ${this.modelo} --thinking off`);

    return new Promise<PiResult>((resolve) => {
      let text = '';
      let finalText = '';
      let thinkingChars = 0;
      let stopReason = '';
      let uso: Record<string, unknown> | undefined;
      let lastPush = 0;
      let stderrLines = 0;
      let out = '';
      let err = '';
      const decOut = new TextDecoder();
      const decErr = new TextDecoder();
      const timer = setTimeout(() => {
        log('ERROR', `Sin terminar después de ${this.cfg.timeoutMs} ms: se detiene el proceso`);
        child.kill();
      }, this.cfg.timeoutMs);

      const onEvent = (e: Record<string, unknown>) => {
        const type = String(e.type);
        if (type === 'session') return log('DEBUG', 'Sesión en memoria (no se guarda)');
        if (type === 'agent_start') return log('INFO', 'Pi empezó a trabajar');
        if (type === 'turn_start') return log('DEBUG', 'Turno del asistente');
        if (type === 'message_update') {
          const a = (e.assistantMessageEvent ?? {}) as Record<string, unknown>;
          if (a.type === 'thinking_start') log('INFO', 'El modelo está razonando (Qwen ignora --thinking off a través de Ollama)');
          else if (a.type === 'thinking_delta') thinkingChars += String(a.delta ?? '').length;
          else if (a.type === 'thinking_end')
            log('INFO', `Razonamiento terminado: ${thinkingChars} caracteres`, { datos: { vista: String(a.content ?? '').slice(0, 400) } });
          else if (a.type === 'text_start') log('INFO', 'Escribiendo la respuesta');
          else if (a.type === 'text_delta') {
            text += String(a.delta ?? '');
            if (Date.now() - lastPush > 400) {
              lastPush = Date.now();
              onText(text);
            }
          } else if (a.type === 'text_end') finalText = String(a.content ?? text);
          else if (a.type === 'toolcall_start') log('WARN', `Pi intentó usar la herramienta «${a.toolName}», pero están desactivadas`);
          return;
        }
        if (type === 'message_end') {
          const m = (e.message ?? {}) as { role?: string; content?: unknown; usage?: Record<string, unknown>; stopReason?: string; errorMessage?: string };
          if (m.role !== 'assistant') return;
          if (Array.isArray(m.content)) {
            const t = m.content
              .filter((c: { type?: string }) => c?.type === 'text')
              .map((c: { text?: string }) => c.text ?? '')
              .join('');
            if (t) finalText = t;
          }
          uso = m.usage;
          stopReason = m.stopReason ?? '';
          log(m.errorMessage ? 'ERROR' : 'INFO', `Mensaje terminado (${m.stopReason ?? '¿?'})${m.errorMessage ? `: ${m.errorMessage}` : ''}`, {
            datos: { uso: m.usage },
          });
          return;
        }
        if (type === 'auto_retry_start') return log('WARN', `Reintento ${e.attempt}/${e.maxAttempts}: ${e.errorMessage}`);
        if (type === 'auto_retry_end') return log(e.success ? 'INFO' : 'ERROR', `Reintento ${e.success ? 'exitoso' : `fallido: ${e.finalError}`}`);
        if (type === 'tool_execution_start') return log('WARN', `Ejecución de herramienta reportada: ${e.toolName}`);
        if (type === 'agent_end') return log('INFO', 'Pi terminó la ejecución');
        if (type === 'agent_settled') return log('DEBUG', `Sin trabajo pendiente${e.aborted ? ' (abortado)' : ''}`);
        log('DEBUG', `Evento ${type}`);
      };

      const lines = (buf: string, flush: boolean, each: (l: string) => void) => {
        const parts = buf.split('\n');
        const rest = flush ? '' : parts.pop()!;
        for (const p of parts) {
          const l = p.replace(/\r$/, '');
          if (l.trim()) each(l);
        }
        return rest;
      };
      const onStdoutLine = (l: string) => {
        try {
          onEvent(JSON.parse(l));
        } catch {
          log('WARN', `Salida no JSON: ${sanitizeText(l, 300)}`);
        }
      };
      const onStderrLine = (l: string) => {
        if (++stderrLines <= 50) log('WARN', `stderr: ${l}`);
        else if (stderrLines === 51) log('WARN', 'stderr: (más líneas omitidas)');
      };

      child.stdout!.on('data', (c: Buffer) => (out = lines(out + decOut.decode(c, { stream: true }), false, onStdoutLine)));
      child.stderr!.on('data', (c: Buffer) => (err = lines(err + decErr.decode(c, { stream: true }), false, onStderrLine)));
      child.on('error', (e) => log('ERROR', `No se pudo iniciar Pi: ${e.message}`));
      child.on('close', (code) => {
        clearTimeout(timer);
        lines(out + decOut.decode(), true, onStdoutLine);
        lines(err + decErr.decode(), true, onStderrLine);
        const ms = Date.now() - t0;
        const texto = (finalText || text).trim();
        const ok = code === 0 && !!texto;
        log(ok ? 'INFO' : 'ERROR', `Proceso terminado con código ${code}`, {
          duracionMs: ms,
          datos: { caracteres: texto.length, razonamiento: thinkingChars },
        });
        this.ultima = { jobId, desde: new Date(t0).toISOString(), hasta: new Date().toISOString(), ms, codigo: code, ok };
        resolve({ texto: sanitizeText(texto, 4000), ms, codigo: code, ok, cortado: stopReason === 'length', uso });
      });
    });
  }
}
