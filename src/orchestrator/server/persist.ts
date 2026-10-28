import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CenterConfig } from './config';
import { CONVERSACION_ANTERIOR, type ChatMessage, type Conversacion, type Job, type LogEntry, type QueueState } from '@protocol';

// Persistencia del centro en <datos>/:
//   ejecuciones.json         todas las ejecuciones conservadas (escritura atómica)
//   cola.json                orden de la cola y si está en pausa
//   registros/<id>.jsonl     registros de cada ejecución (una línea por registro)
//   registros/sistema.jsonl  registros sin ejecución (servidor, chat, Pi)
//   chat.jsonl               historial del chat (cada mensaje dice su conversación)
//   conversaciones.json      conversaciones del chat
// JSON/JSONL como el resto del orquestador: no depende de que la base de datos esté arriba.

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function atomicWrite(path: string, data: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readJsonl<T>(path: string, limit: number): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const out: T[] = [];
  for (const l of lines.slice(-limit - 1)) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      /* línea cortada por un apagado: se ignora */
    }
  }
  return out.slice(-limit);
}

export class CenterStore {
  private readonly logCount = new Map<string, number>();

  constructor(
    readonly dir: string,
    private readonly retention: CenterConfig['retencion'],
  ) {
    mkdirSync(join(dir, 'registros'), { recursive: true });
  }

  loadJobs(): Job[] {
    const p = join(this.dir, 'ejecuciones.json');
    if (!existsSync(p)) return [];
    return (JSON.parse(readFileSync(p, 'utf8')) as { jobs: Job[] }).jobs ?? [];
  }

  saveJobs(jobs: Job[]) {
    atomicWrite(join(this.dir, 'ejecuciones.json'), JSON.stringify({ version: 1, jobs }, null, 1));
  }

  loadQueue(): Pick<QueueState, 'orden' | 'pausada'> {
    const p = join(this.dir, 'cola.json');
    if (!existsSync(p)) return { orden: [], pausada: false };
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  saveQueue(q: Pick<QueueState, 'orden' | 'pausada'>) {
    atomicWrite(join(this.dir, 'cola.json'), JSON.stringify({ orden: q.orden, pausada: q.pausada }));
  }

  private logFile(jobId?: string) {
    if (jobId && !ID_RE.test(jobId)) throw new Error('id de ejecución inválido');
    return join(this.dir, 'registros', `${jobId ?? 'sistema'}.jsonl`);
  }

  /** Guarda un registro (ya sanitizado). Pasado el límite por ejecución se deja una sola marca. */
  appendLog(e: LogEntry) {
    const key = e.jobId ?? 'sistema';
    const n = (this.logCount.get(key) ?? this.countLines(key)) + 1;
    this.logCount.set(key, n);
    const limit = this.retention.logsPorEjecucion;
    if (n > limit + 1) return;
    const line =
      n === limit + 1
        ? {
            ...e,
            nivel: 'WARN',
            mensaje: `Se alcanzó el límite de ${limit} registros guardados para esta ejecución; los siguientes sólo se ven en vivo.`,
            datos: undefined,
          }
        : e;
    appendFileSync(this.logFile(e.jobId), JSON.stringify(line) + '\n');
    if (!e.jobId && n > limit * 2) this.trimFile(this.logFile(), limit, 'sistema');
  }

  private countLines(key: string) {
    const p = this.logFile(key === 'sistema' ? undefined : key);
    return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).length : 0;
  }

  private trimFile(path: string, keep: number, key: string) {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-keep);
    atomicWrite(path, lines.join('\n') + '\n');
    this.logCount.set(key, lines.length);
  }

  readLogs(jobId: string | undefined, limit = 2000): LogEntry[] {
    return readJsonl<LogEntry>(this.logFile(jobId), limit);
  }

  appendChat(m: ChatMessage) {
    const p = join(this.dir, 'chat.jsonl');
    appendFileSync(p, JSON.stringify(m) + '\n');
    if (statSync(p).size > 2_000_000) this.trimFile(p, this.retention.chat, 'chat');
  }

  /** Últimos mensajes guardados; con `conversacion`, sólo los de esa conversación. */
  loadChat(limit = this.retention.chat, conversacion?: string): ChatMessage[] {
    // Un mensaje se puede guardar varias veces (Pi escribiendo): vale la última versión de cada id
    const all = readJsonl<ChatMessage>(join(this.dir, 'chat.jsonl'), conversacion ? Number.MAX_SAFE_INTEGER : limit * 3);
    const byId = new Map<string, ChatMessage>();
    for (const m of all) if (!conversacion || (m.conversacion ?? CONVERSACION_ANTERIOR) === conversacion) byId.set(m.id, m);
    return [...byId.values()].slice(-limit);
  }

  loadConversations(): Conversacion[] {
    const p = join(this.dir, 'conversaciones.json');
    if (!existsSync(p)) return [];
    return (JSON.parse(readFileSync(p, 'utf8')) as { conversaciones: Conversacion[] }).conversaciones ?? [];
  }

  saveConversations(list: Conversacion[]) {
    atomicWrite(join(this.dir, 'conversaciones.json'), JSON.stringify({ version: 1, conversaciones: list }, null, 1));
  }

  /** Quita las ejecuciones terminadas más viejas (y sus registros) por encima del límite. */
  prune(jobs: Job[], isFinished: (j: Job) => boolean): Job[] {
    const finished = jobs.filter(isFinished).sort((a, b) => (a.finalizadoEn ?? a.creadoEn).localeCompare(b.finalizadoEn ?? b.creadoEn));
    const drop = new Set(finished.slice(0, Math.max(0, finished.length - this.retention.ejecuciones)).map((j) => j.id));
    for (const id of drop) rmSync(this.logFile(id), { force: true });
    // registros huérfanos (de ejecuciones que ya no existen)
    const keep = new Set(jobs.filter((j) => !drop.has(j.id)).map((j) => j.id));
    for (const f of readdirSync(join(this.dir, 'registros'))) {
      const id = f.replace(/\.jsonl$/, '');
      if (id !== 'sistema' && !keep.has(id)) rmSync(join(this.dir, 'registros', f), { force: true });
    }
    return jobs.filter((j) => !drop.has(j.id));
  }
}
