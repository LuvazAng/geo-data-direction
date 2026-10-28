import { createHash } from 'node:crypto';
import type { OrqConfig } from '../config';
import { mentions, samePlace } from '../domain/places';

// Qwen 3.5 4B en el runtime local (Ollama), llamado directamente: una petición por mapa dudoso,
// sin agente, sin herramientas y sin acceso a archivos. Recibe un resumen (textos, candidatos,
// localidades de los extremos, similitudes ya calculadas), nunca coordenadas completas ni
// credenciales. Su respuesta es una propuesta: se valida aquí y después el backend la vuelve a
// comprobar contra la geometría. No se cambia de modelo si el configurado no está disponible.

export interface TraceQuestion {
  indice: number;
  nombre: string;
  descripcion: string;
  tipo: string;
  longitudKm: number;
  inicio: { localidades: string[]; municipio?: string };
  final: { localidades: string[]; municipio?: string };
  decisionActual: { origen: string | null; destino: string | null; sentido: string; motivos: string[] };
}

export interface MapQuestion {
  ruta: string;
  mapa: string;
  lugaresDelTitulo: string[];
  candidatos: string[];
  trazos: TraceQuestion[];
  similitudes: { a: number; b: number; clase: string; similitud: number; sentido: string }[];
}

export type IaRol = 'ida' | 'regreso' | 'circuito' | 'tramo' | 'ampliacion' | 'otro';

export interface TraceAnswer {
  indice: number;
  origen: string | null;
  destino: string | null;
  via: string | null;
  rol: IaRol;
  confianza: 'alta' | 'media' | 'baja';
}

export interface MapAnswer {
  trazos: TraceAnswer[];
  explicacion: string;
}

export interface LlmResult {
  answer: MapAnswer | null;
  descartes: string[];
  error?: string;
  cached: boolean;
  ms: number;
}

const ROLES: IaRol[] = ['ida', 'regreso', 'circuito', 'tramo', 'ampliacion', 'otro'];

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    trazos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          indice: { type: 'integer' },
          origen: { type: ['string', 'null'] },
          destino: { type: ['string', 'null'] },
          via: { type: ['string', 'null'] },
          rol: { type: 'string', enum: ROLES },
          confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        },
        required: ['indice', 'origen', 'destino', 'via', 'rol', 'confianza'],
      },
    },
    explicacion: { type: 'string' },
  },
  required: ['trazos', 'explicacion'],
} as const;

const SYSTEM = [
  'Interpretas metadatos de rutas de transporte público de Morelos, México.',
  'Para cada trazo indica de dónde sale (origen) y a dónde llega (destino) el servicio, por dónde pasa (via) sólo si el texto lo dice, y su rol.',
  'Usa únicamente nombres de la lista "candidatos". Si no hay evidencia suficiente, usa null: no adivines.',
  'Las localidades de inicio y final son las que hay junto al primer y al último punto del trazo; úsalas como pista.',
  'No calcules distancias ni porcentajes: ya vienen calculados.',
  'En "explicacion" di en una o dos frases qué resolviste y qué falta para resolver lo demás.',
  'Responde sólo con el JSON pedido.',
].join(' ');

/** Valida la respuesta: estructura, índices existentes y nombres dentro de los candidatos. */
export function validateAnswer(raw: unknown, q: MapQuestion): { answer: MapAnswer; descartes: string[] } {
  const descartes: string[] = [];
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as MapAnswer).trazos)) throw new Error('Respuesta sin "trazos"');
  const r = raw as Record<string, unknown>;
  const indices = new Set(q.trazos.map((t) => t.indice));
  const pick = (v: unknown, field: string, idx: number): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string') {
      descartes.push(`trazo ${idx}: ${field} no es texto`);
      return null;
    }
    const match = q.candidatos.find((c) => samePlace(c, v));
    if (!match) descartes.push(`trazo ${idx}: ${field} «${v}» no está entre los candidatos`);
    return match ?? null;
  };
  const seen = new Set<number>();
  const trazos: TraceAnswer[] = [];
  for (const t of (r.trazos as Record<string, unknown>[]) ?? []) {
    const idx = Number(t?.indice);
    if (!Number.isInteger(idx) || !indices.has(idx) || seen.has(idx)) {
      descartes.push(`índice de trazo inválido o repetido: ${String(t?.indice)}`);
      continue;
    }
    seen.add(idx);
    const tq = q.trazos.find((x) => x.indice === idx)!;
    const via = typeof t.via === 'string' && t.via.trim() ? t.via.trim() : null;
    const viaOk = via && mentions(`${tq.nombre} ${tq.descripcion}`, via) ? via : null;
    if (via && !viaOk) descartes.push(`trazo ${idx}: via «${via}» no aparece en sus textos`);
    trazos.push({
      indice: idx,
      origen: pick(t.origen, 'origen', idx),
      destino: pick(t.destino, 'destino', idx),
      via: viaOk,
      rol: ROLES.includes(t.rol as IaRol) ? (t.rol as IaRol) : 'otro',
      confianza: ['alta', 'media', 'baja'].includes(t.confianza as string) ? (t.confianza as TraceAnswer['confianza']) : 'baja',
    });
  }
  const explicacion = typeof r.explicacion === 'string' ? r.explicacion.trim().slice(0, 600) : '';
  return { answer: { trazos, explicacion }, descartes };
}

export interface LlmCache {
  get(key: string): MapAnswer | undefined;
  set(key: string, value: MapAnswer): void;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ConverseTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ConverseProgress {
  fase: 'esperando' | 'cargando' | 'pensando' | 'respondiendo';
  texto: string;
  razonamiento: string;
}

export interface ConverseResult {
  texto: string;
  razonamiento: string;
  ms: number;
  cargaMs?: number;
  /** Desde que se le mandó la petición hasta su primer token. */
  primerTokenMs?: number;
  tokens: { entrada?: number; salida?: number };
  tokPorSeg?: number;
  /** done_reason de Ollama ("stop", "length"). */
  motivo?: string;
  /** El razonamiento llegó al presupuesto y se le pidió responder con lo que ya había pensado. */
  recortado: boolean;
  detenido: boolean;
  error?: string;
}

interface OllamaChunk {
  message?: { content?: string; thinking?: string };
  /** /api/generate */
  response?: string;
  done?: boolean;
  done_reason?: string;
  error?: string;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Tokens para la respuesta (aparte del razonamiento). Con el razonamiento y el contexto cabe en num_ctx 8192. */
export const CONVERSE_ANSWER_TOKENS = 1536;
const CONVERSE_IDLE_MS = 90_000;

/** Cierre del razonamiento que recomienda Qwen para su presupuesto de razonamiento («thinking budget»). */
export const CIERRE_RAZONAMIENTO =
  '\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>\n\n';

/** Formato de chat de Qwen (ChatML) para continuar una respuesta en modo raw; sin marcas del formato dentro del texto. */
export function chatml(turns: ConverseTurn[]): string {
  return `${turns.map((t) => `<|im_start|>${t.role}\n${stripMarks(t.content)}<|im_end|>\n`).join('')}<|im_start|>assistant\n`;
}

const stripMarks = (s: string) => s.replace(/<\|im_(start|end)\|>|<\/?think>/g, '');

class IdleError extends Error {}

// ---------------------------------------------------------------------------
// Un solo uso del modelo a la vez en el proceso (orquestador, chat y Pi comparten la GPU), y lo
// que se puede observar de esa actividad: qué tarea, desde cuándo, cuánto tardó. Nada más: el
// runtime no expone el "razonamiento" con format + think:false, y no se inventa.
// ---------------------------------------------------------------------------

export interface ModelActivity {
  origen: 'orquestador' | 'chat' | 'pi' | 'editor';
  tarea: string;
  modelo: string;
  desde: string;
}

export const modelStatus: {
  actual: ModelActivity | null;
  enEspera: number;
  ultima: (ModelActivity & { hasta: string; ms: number; ok: boolean; detalle?: string }) | null;
} = { actual: null, enEspera: 0, ultima: null };

let gateTail: Promise<unknown> = Promise.resolve();

/** Ejecuta `fn` cuando el modelo está libre y deja constancia de la actividad. */
export function withModel<T>(activity: Omit<ModelActivity, 'desde'>, fn: () => Promise<T>, done?: (r: T) => { ok: boolean; detalle?: string }): Promise<T> {
  modelStatus.enEspera++;
  const run = gateTail.then(async () => {
    modelStatus.enEspera--;
    const actual: ModelActivity = { ...activity, desde: new Date().toISOString() };
    modelStatus.actual = actual;
    const t0 = Date.now();
    let ok = false;
    let detalle: string | undefined;
    try {
      const r = await fn();
      ({ ok, detalle } = done ? done(r) : { ok: true, detalle: undefined });
      return r;
    } catch (e) {
      detalle = (e as Error).message;
      throw e;
    } finally {
      modelStatus.actual = null;
      modelStatus.ultima = { ...actual, hasta: new Date().toISOString(), ms: Date.now() - t0, ok, detalle };
    }
  });
  gateTail = run.catch(() => undefined);
  return run;
}

export class QwenClient {
  constructor(
    private readonly cfg: OrqConfig['ia'],
    private readonly cache: LlmCache,
    private readonly fetchImpl: FetchLike = (i, o) => fetch(i, o),
  ) {}

  get modelo() {
    return this.cfg.modelo;
  }

  private async call(path: string, body?: unknown): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(new URL(path, this.cfg.url).href, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new Error(`Qwen no respondió en ${this.cfg.timeoutMs} ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** ¿Está el runtime arriba y el modelo descargado? (no descarga nada) */
  async available(): Promise<{ ok: boolean; detalle: string }> {
    try {
      const tags = (await this.call('/api/tags')) as { models?: { name: string }[] };
      const names = (tags.models ?? []).map((m) => m.name);
      if (!names.includes(this.cfg.modelo)) {
        return {
          ok: false,
          detalle: `El modelo ${this.cfg.modelo} no está en Ollama (hay: ${names.join(', ') || 'ninguno'}). No se descarga automáticamente: ollama pull ${this.cfg.modelo}`,
        };
      }
      return { ok: true, detalle: `${this.cfg.modelo} disponible` };
    } catch (e) {
      return { ok: false, detalle: `Ollama no disponible en ${this.cfg.url}: ${(e as Error).message}` };
    }
  }

  /**
   * Pide al modelo un JSON con el esquema dado y lo valida. Reintenta respuestas inválidas
   * (`ia.reintentos`). Una petición a la vez en todo el proceso.
   */
  async structured<T>(
    system: string,
    payload: string,
    schema: unknown,
    validate: (raw: unknown) => T,
    activity: { origen: ModelActivity['origen']; tarea: string },
  ): Promise<{ value: T | null; error?: string; ms: number; intentos: number; tokens?: { entrada?: number; salida?: number } }> {
    return withModel(
      { ...activity, modelo: this.cfg.modelo },
      async () => {
        const t0 = Date.now();
        let lastError = '';
        let intentos = 0;
        for (let attempt = 0; attempt <= this.cfg.reintentos; attempt++) {
          intentos++;
          try {
            const res = (await this.call('/api/chat', {
              model: this.cfg.modelo,
              stream: false,
              think: false,
              format: schema,
              options: { temperature: 0, seed: 42, num_ctx: 8192 },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: payload },
              ],
            })) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
            const content = res.message?.content ?? '';
            let parsed: unknown;
            try {
              parsed = JSON.parse(content);
            } catch {
              throw new Error(`respuesta no es JSON: ${content.slice(0, 120)}`);
            }
            return { value: validate(parsed), ms: Date.now() - t0, intentos, tokens: { entrada: res.prompt_eval_count, salida: res.eval_count } };
          } catch (e) {
            lastError = (e as Error).message;
          }
        }
        return { value: null, error: lastError, ms: Date.now() - t0, intentos };
      },
      (r) => ({ ok: r.value !== null, detalle: r.error }),
    );
  }

  /**
   * Lee una respuesta en streaming de Ollama (una línea JSON por trozo). `onBatch` se llama tras
   * cada lectura; si devuelve true se corta ahí la respuesta (y Ollama deja de generar).
   */
  private async stream(
    path: string,
    body: unknown,
    o: { signal?: AbortSignal; idleMs: number; onChunk: (c: OllamaChunk) => void; onBatch: () => boolean },
  ): Promise<{ end: OllamaChunk | null; cortado: boolean }> {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    o.signal?.addEventListener('abort', stop);
    let idle: NodeJS.Timeout | undefined;
    let idleHit = false;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        idleHit = true;
        ctrl.abort();
      }, o.idleMs);
    };
    arm();
    try {
      const res = await this.fetchImpl(new URL(path, this.cfg.url).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (!res.body) throw new Error('Ollama respondió sin contenido');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let end = null as OllamaChunk | null;
      const take = (line: string) => {
        if (!line.trim()) return false;
        let c: OllamaChunk;
        try {
          c = JSON.parse(line);
        } catch {
          return false;
        }
        if (c.error) throw new Error(`Ollama: ${c.error}`);
        o.onChunk(c);
        if (c.done) end = c;
        return true;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buf += dec.decode(value, { stream: true });
        let changed = false;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          changed = take(buf.slice(0, i)) || changed;
          buf = buf.slice(i + 1);
        }
        if (changed && o.onBatch()) {
          ctrl.abort();
          await reader.cancel().catch(() => {});
          return { end: null, cortado: true };
        }
      }
      take(buf + dec.decode());
      return { end, cortado: false };
    } catch (e) {
      if (idleHit) throw new IdleError(`Qwen dejó de responder (${Math.round(o.idleMs / 1000)} s sin recibir nada)`);
      throw e;
    } finally {
      clearTimeout(idle);
      o.signal?.removeEventListener('abort', stop);
    }
  }

  /**
   * Conversación libre en streaming: el razonamiento y la respuesta llegan por separado, tal como
   * los entrega Ollama. `presupuesto` = tokens de razonamiento (0: sin razonar). Si el razonamiento
   * lo agota sin haber empezado a responder, se corta y se continúa en modo raw con el formato de
   * Qwen y su cierre recomendado: responde con lo que ya pensó, en lugar de razonar hasta llenar el
   * contexto. Mismo num_ctx que las consultas estructuradas para no obligar a Ollama a recargar el
   * modelo. `turns` se arma cuando el modelo queda libre (así el estado que lee es el de ese
   * momento). Una petición a la vez en todo el proceso.
   */
  async converse(
    turns: () => ConverseTurn[],
    opts: { presupuesto: number; signal?: AbortSignal; maxRespuesta?: number; inactividadMs?: number },
    onProgress: (p: ConverseProgress) => void,
    activity: { origen: ModelActivity['origen']; tarea: string } = { origen: 'chat', tarea: 'responder en el chat' },
  ): Promise<ConverseResult> {
    onProgress({ fase: 'esperando', texto: '', razonamiento: '' });
    return withModel(
      { ...activity, modelo: this.cfg.modelo },
      async () => {
        const t0 = Date.now();
        let texto = '';
        let razonamiento = '';
        let pensados = 0; // Ollama manda un trozo por token
        let primer: number | undefined;
        let recortado = false;
        const result = (r: Partial<ConverseResult>): ConverseResult => ({
          texto: texto.trim(),
          razonamiento: razonamiento.trim(),
          ms: Date.now() - t0,
          primerTokenMs: primer !== undefined ? primer - t0 : undefined,
          tokens: {},
          recortado,
          detenido: false,
          ...r,
        });
        if (opts.signal?.aborted) return result({ detenido: true });
        const idleMs = opts.inactividadMs ?? CONVERSE_IDLE_MS;
        const respuesta = opts.maxRespuesta ?? CONVERSE_ANSWER_TOKENS;
        const think = opts.presupuesto > 0;
        const progress = () => onProgress({ fase: texto.trim() ? 'respondiendo' : razonamiento ? 'pensando' : 'cargando', texto, razonamiento });
        onProgress({ fase: 'cargando', texto, razonamiento });
        try {
          const messages = turns();
          const p1 = await this.stream(
            '/api/chat',
            { model: this.cfg.modelo, stream: true, think, options: { num_ctx: 8192, num_predict: opts.presupuesto + respuesta }, messages },
            {
              signal: opts.signal,
              idleMs,
              onChunk: (c) => {
                if (c.message?.thinking) {
                  razonamiento += c.message.thinking;
                  pensados++;
                }
                if (c.message?.content) texto += c.message.content;
                if ((c.message?.thinking || c.message?.content) && primer === undefined) primer = Date.now();
              },
              onBatch: () => (progress(), think && !texto.trim() && pensados >= opts.presupuesto),
            },
          );
          let end = p1.end;
          let tokens: ConverseResult['tokens'] = { entrada: end?.prompt_eval_count, salida: end?.eval_count };
          if (p1.cortado) {
            recortado = true;
            const prompt = `${chatml(messages)}<think>\n${stripMarks(razonamiento.trim())}${CIERRE_RAZONAMIENTO}`;
            const p2 = await this.stream(
              '/api/generate',
              { model: this.cfg.modelo, raw: true, stream: true, prompt, options: { num_ctx: 8192, num_predict: respuesta } },
              {
                signal: opts.signal,
                idleMs,
                onChunk: (c) => {
                  if (c.response) texto += c.response;
                },
                onBatch: () => (progress(), false),
              },
            );
            end = p2.end;
            // el contexto de la segunda petición incluye el razonamiento ya generado
            tokens = {
              entrada: end?.prompt_eval_count !== undefined ? Math.max(0, end.prompt_eval_count - pensados) : undefined,
              salida: pensados + (end?.eval_count ?? 0),
            };
          }
          const evalS = end?.eval_duration ? end.eval_duration / 1e9 : 0;
          return result({
            cargaMs: p1.end?.load_duration !== undefined ? Math.round(p1.end.load_duration / 1e6) : undefined,
            tokens,
            tokPorSeg: evalS && end?.eval_count ? Math.round((end.eval_count / evalS) * 10) / 10 : undefined,
            motivo: end?.done_reason,
            ...(!end && { error: 'Ollama cerró la respuesta antes de terminar' }),
          });
        } catch (e) {
          if (opts.signal?.aborted) return result({ detenido: true });
          return result({ error: (e as Error).message });
        }
      },
      (r) => ({ ok: !r.error && !r.detenido, detalle: r.error ?? (r.detenido ? 'detenido a petición del usuario' : undefined) }),
    );
  }

  /** @param soloCache no consultar al modelo: devolver sólo una respuesta ya guardada (o ninguna). */
  async interpretMap(q: MapQuestion, opts: { soloCache?: boolean } = {}): Promise<LlmResult> {
    const payload = JSON.stringify(q);
    const key = createHash('sha256').update(`${this.cfg.modelo}\n${SYSTEM}\n${payload}`).digest('hex');
    const hit = this.cache.get(key);
    if (hit) return { answer: hit, descartes: [], cached: true, ms: 0 };
    if (opts.soloCache) return { answer: null, descartes: [], cached: false, ms: 0, error: 'sin respuesta en caché (no se consultó al modelo)' };
    let descartes: string[] = [];
    const r = await this.structured(
      SYSTEM,
      payload,
      ANSWER_SCHEMA,
      (raw) => {
        const v = validateAnswer(raw, q);
        descartes = v.descartes;
        return v.answer;
      },
      { origen: 'orquestador', tarea: `interpretar «${q.mapa}» (${q.trazos.length} trazo(s))` },
    );
    if (!r.value) return { answer: null, descartes: [], error: r.error, cached: false, ms: r.ms };
    this.cache.set(key, r.value);
    return { answer: r.value, descartes, cached: false, ms: r.ms };
  }

  /** Modelos cargados en el runtime ahora mismo (lo que Ollama expone en /api/ps). */
  async loaded(): Promise<{ name: string; size: number; size_vram?: number; expires_at?: string; context_length?: number }[]> {
    const r = (await this.call('/api/ps')) as { models?: { name: string; size: number; size_vram?: number; expires_at?: string; context_length?: number }[] };
    return r.models ?? [];
  }
}
