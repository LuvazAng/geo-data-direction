import {
  CONVERSACION_ANTERIOR,
  type ChatMessage,
  type Conversacion,
  type FileState,
  type Job,
  type LogEntry,
  type ModelInfo,
  type QueueState,
  type RouteUnit,
  type ServerEvent,
  type Snapshot,
} from '@protocol';

// Estado del centro de control en el navegador: se arma con el estado completo (snapshot) y se
// mantiene con los eventos del servidor. Función pura: se prueba sin navegador.

export type Connection = 'apagado' | 'conectando' | 'conectado' | 'reconectando';

export interface LiveFile {
  jobId: string;
  lote: string;
  ruta: string;
  mapa?: string;
  rel?: string;
  estado: FileState;
  detalle?: string;
  ts: number;
}

export interface CenterState {
  conexion: Connection;
  /** Cuándo se recibió el último evento o estado (para mostrar si los datos son viejos). */
  ultimoEvento: number | null;
  servidor: Snapshot['servidor'] | null;
  lotes: Snapshot['lotes'];
  cola: QueueState;
  jobs: Record<string, Job>;
  rutas: RouteUnit[];
  logs: LogEntry[];
  modelos: ModelInfo | null;
  chat: ChatMessage[];
  /** Conversaciones del chat, la más reciente primero. */
  conversaciones: Conversacion[];
  /** Archivos tocados por las ejecuciones en curso (para marcar lo que está en proceso). */
  archivosVivos: LiveFile[];
  /** Sube cada vez que cambian carpetas o archivos de un lote: las vistas vuelven a pedir datos. */
  version: Record<string, number>;
}

export const MAX_LOGS = 3000;
const MAX_LIVE = 600;

export const initialState: CenterState = {
  conexion: 'apagado',
  ultimoEvento: null,
  servidor: null,
  lotes: [],
  cola: { orden: [], pausada: false, maxSimultaneas: 1 },
  jobs: {},
  rutas: [],
  logs: [],
  modelos: null,
  chat: [],
  conversaciones: [],
  archivosVivos: [],
  version: {},
};

export type CenterAction =
  | { type: 'conexion'; conexion: Connection }
  | { type: 'evento'; event: ServerEvent; at: number }
  | { type: 'chat'; messages: ChatMessage[] }
  | { type: 'conversacion'; conversacion: Conversacion }
  | { type: 'logs-anteriores'; logs: LogEntry[] };

const byRecent = (a: Conversacion, b: Conversacion) => b.actualizadaEn.localeCompare(a.actualizadaEn);

function upsertConversation(list: Conversacion[], c: Conversacion): Conversacion[] {
  return [...list.filter((x) => x.id !== c.id), c].sort(byRecent);
}

/** Conversación de un mensaje (los de antes de que hubiera conversaciones quedan en «Mensajes anteriores»). */
export const conversationOf = (m: ChatMessage) => m.conversacion ?? CONVERSACION_ANTERIOR;

function upsertMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [...list, m].sort((a, b) => a.ts.localeCompare(b.ts));
  // la respuesta HTTP puede llegar después de versiones más nuevas recibidas por eventos
  const old = list[i];
  if ((old.rev !== undefined && m.rev !== undefined && m.rev < old.rev) || (!old.parcial && m.parcial)) return list;
  const copy = list.slice();
  copy[i] = m;
  return copy;
}

/** Tras un reinicio del servidor, una respuesta que estaba escribiéndose ya no va a terminar. */
function closeOrphans(list: ChatMessage[]): ChatMessage[] {
  if (!list.some((m) => m.parcial)) return list;
  return list.map((m) =>
    m.parcial
      ? {
          ...m,
          parcial: false,
          bloques: [...m.bloques, { tipo: 'error', texto: 'Se interrumpió: el servidor del centro se reinició.' }],
          ...(m.qwen && { qwen: { ...m.qwen, fase: 'error' as const } }),
        }
      : m,
  );
}

function mergeLogs(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const seen = new Set(current.map((l) => l.seq));
  const merged = [...current, ...incoming.filter((l) => !seen.has(l.seq))].sort((a, b) => a.seq - b.seq);
  return merged.length > MAX_LOGS ? merged.slice(merged.length - MAX_LOGS) : merged;
}

const bump = (v: Record<string, number>, lote: string) => ({ ...v, [lote]: (v[lote] ?? 0) + 1 });

export function reducer(s: CenterState, a: CenterAction): CenterState {
  switch (a.type) {
    case 'conexion':
      return { ...s, conexion: a.conexion };
    case 'chat':
      return { ...s, chat: a.messages.reduce(upsertMessage, s.chat) };
    case 'conversacion':
      return { ...s, conversaciones: upsertConversation(s.conversaciones, a.conversacion) };
    case 'logs-anteriores':
      return { ...s, logs: mergeLogs(s.logs, a.logs) };
    case 'evento': {
      const e = a.event;
      const base = { ...s, ultimoEvento: a.at, conexion: 'conectado' as const };
      switch (e.type) {
        case 'snapshot': {
          const jobs: Record<string, Job> = {};
          for (const j of e.data.jobs) jobs[j.id] = j;
          // Tras un reinicio del servidor, lo que no está en el estado nuevo ya no corre
          const live = s.archivosVivos.filter((f) => jobs[f.jobId] && (jobs[f.jobId].estado === 'PENDIENTE' || jobs[f.jobId].estado.startsWith('EN_')));
          const version = Object.fromEntries(e.data.lotes.map((l) => [l.lote, (s.version[l.lote] ?? 0) + 1]));
          const chat = s.servidor && s.servidor.bootId !== e.data.servidor.bootId ? closeOrphans(s.chat) : s.chat;
          const conversaciones = [...(e.data.conversaciones ?? [])].sort(byRecent);
          return {
            ...base,
            servidor: e.data.servidor,
            lotes: e.data.lotes,
            cola: e.data.cola,
            jobs,
            rutas: e.data.rutas,
            logs: mergeLogs([], e.data.logs),
            modelos: e.data.modelos,
            archivosVivos: live,
            version,
            chat,
            conversaciones,
          };
        }
        case 'job.created':
        case 'job.queued':
        case 'job.started':
        case 'job.stage_changed':
        case 'job.progress':
        case 'job.completed':
        case 'job.failed':
        case 'job.cancelled': {
          const done = e.type === 'job.completed' || e.type === 'job.failed' || e.type === 'job.cancelled';
          return {
            ...base,
            jobs: { ...s.jobs, [e.data.id]: e.data },
            archivosVivos: done ? s.archivosVivos.filter((f) => f.jobId !== e.data.id) : s.archivosVivos,
            version: done ? bump(s.version, e.data.lote) : s.version,
          };
        }
        case 'job.log':
          return { ...base, logs: mergeLogs(s.logs, [e.data]) };
        case 'job.file_detected':
        case 'job.file_updated': {
          const f: LiveFile = { ...e.data, ts: a.at };
          const key = (x: LiveFile) => `${x.jobId}|${x.mapa ?? ''}|${x.rel ?? ''}`;
          const rest = s.archivosVivos.filter((x) => key(x) !== key(f));
          const list = [...rest, f];
          return {
            ...base,
            archivosVivos: list.length > MAX_LIVE ? list.slice(list.length - MAX_LIVE) : list,
            version: f.rel?.startsWith('resultados/') ? bump(s.version, f.lote) : s.version,
          };
        }
        case 'queue.updated':
          return { ...base, cola: e.data };
        case 'routes.updated':
          return { ...base, rutas: e.data };
        case 'folder.updated':
          return { ...base, version: bump(s.version, e.data.lote) };
        case 'chat.message':
          return { ...base, chat: upsertMessage(s.chat, e.data) };
        case 'chat.conversation':
          return { ...base, conversaciones: upsertConversation(s.conversaciones, e.data) };
        case 'chat.delta': {
          const d = e.data;
          const i = s.chat.findIndex((m) => m.id === d.id);
          const m = s.chat[i];
          // sólo sobre la versión inmediatamente anterior; si se perdió un trozo, se espera la siguiente versión completa
          if (i < 0 || !m.parcial || m.rev === undefined || d.rev !== m.rev + 1) return base;
          const chat = s.chat.slice();
          chat[i] = {
            ...m,
            rev: d.rev,
            texto: m.texto + (d.texto ?? ''),
            ...(m.qwen && {
              qwen: { ...m.qwen, ...(d.fase && { fase: d.fase }), ...(d.razonamiento && { razonamiento: (m.qwen.razonamiento ?? '') + d.razonamiento }) },
            }),
          };
          return { ...base, chat };
        }
        case 'models.updated':
          return { ...base, modelos: e.data };
      }
      return base;
    }
  }
}

export const isActive = (j: Job) => j.estado.startsWith('EN_');
export const isFinished = (j: Job) => ['COMPLETADO', 'COMPLETADO_CON_ADVERTENCIAS', 'FALLIDO', 'CANCELADO', 'INTERRUMPIDO'].includes(j.estado);
