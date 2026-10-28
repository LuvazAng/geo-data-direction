import type {
  Action,
  ChatMessage,
  ChatOptions,
  Conversacion,
  FilesSnapshot,
  Job,
  LogEntry,
  QueueState,
  ReviewAction,
  ReviewDirection,
  ReviewItem,
  ReviewKind,
  ReviewSnapshot,
  SiglasRequest,
  SiglasResponse,
} from '@protocol';

// Cliente del servidor del centro de control (a través del proxy /api de Vite).

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('Sin conexión con el centro de control', 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // El proxy de Vite responde texto cuando el servidor no está arriba
    throw new ApiError(
      res.status >= 500 ? 'El servidor del centro no responde (¿está corriendo `npm run centro`?)' : `Respuesta inesperada (${res.status})`,
      res.status,
    );
  }
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? `Error ${res.status}`, res.status);
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const qs = (params: Record<string, string | number | undefined | string[]>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const t = s.toString();
  return t ? `?${t}` : '';
};

export const api = {
  chatHistory: (conversacion?: string) => request<ChatMessage[]>(`/chat${qs({ limite: 300, conversacion })}`),
  chat: (texto: string, opciones: ChatOptions = {}) => post<ChatMessage[]>('/chat', { texto, ...opciones }),
  stopQwen: (id?: string) => post<{ detenidas: number }>('/chat/detener', { id }),
  newConversation: () => post<Conversacion>('/conversaciones'),
  action: (accion: Action, conversacion?: string) => post<ChatMessage[]>('/acciones', { accion, conversacion }),
  enqueue: (body: {
    lote: string;
    ruta?: string;
    primero?: boolean;
    iniciar?: boolean;
    parametros?: { sinRed?: boolean; sinIa?: boolean; refrescar?: boolean };
    clave?: string;
  }) => post<{ job: Job; creado: boolean }>('/cola', body),
  reorder: (ids: string[]) => post<QueueState>('/cola/orden', { ids }),
  pause: () => post<QueueState>('/cola/pausar'),
  resume: () => post<QueueState>('/cola/reanudar'),
  runNext: () => post<{ job: Job | null }>('/cola/siguiente'),
  start: (id: string) => post<{ resultado: string; job: Job }>(`/jobs/${id}/iniciar`),
  first: (id: string) => post<QueueState>(`/jobs/${id}/primero`),
  cancel: (id: string) => post<{ resultado: string; job: Job }>(`/jobs/${id}/cancelar`),
  retry: (id: string) => post<{ job: Job }>(`/jobs/${id}/reintentar`),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  jobReport: (id: string) => request<JobReport | null>(`/jobs/${id}/reporte`),
  jobLogs: (id: string) => request<LogEntry[]>(`/jobs/${id}/registros?limite=5000`),
  logs: (f: { componente?: string[]; nivel?: string[]; jobId?: string; ruta?: string; q?: string; antesDe?: number; limite?: number }) =>
    request<LogEntry[]>(`/registros${qs(f)}`),
  files: (lote: string, ruta?: string) => request<FilesSnapshot>(`/archivos${qs({ lote, ruta })}`),
  reviews: (lote: string) => request<ReviewSnapshot>(`/revisiones${qs({ lote })}`),
  resolveReview: (body: {
    lote: string;
    traza: string;
    accion: ReviewAction;
    tipo?: ReviewKind;
    nombre?: string;
    nota?: string;
    origen?: string;
    destino?: string;
    sentido?: ReviewDirection;
    relacionPrincipal?: string;
    contenidoKml?: string;
  }) => post<ReviewItem>('/revisiones', body),
  resolveReviews: (body: {
    lote: string;
    items: (
      { accion?: 'generar'; traza: string; nombre: string; contenidoKml: string; nota?: string } | { accion: 'descartar'; traza: string; nota?: string }
    )[];
  }) => post<ReviewItem[]>('/revisiones/lote', body),
  undoMapReviews: (body: { lote: string; mapa: string }) => post<ReviewItem[]>('/revisiones/deshacer-mapa', body),
  /** Mapa sin itinerarios evaluado a mano en el editor: los trazos que quedaron, con su dupla. */
  evaluateMap: (body: {
    lote: string;
    mapa: string;
    generar: { traza: string; nombre: string; contenidoKml: string; dupla: number; nota?: string }[];
    descartar: { traza: string; nota?: string }[];
  }) => post<ReviewItem[]>('/revisiones/mapa', body),
  /** Siglas de las colonias de un trazo para armar su nombre (catálogo, Qwen o regla). */
  suggestSiglas: (body: SiglasRequest) => post<SiglasResponse>('/nombres/siglas', body),
  decideMap: (body: { lote: string; mapa: string; accion: 'descartar' | 'deshacer'; nota?: string }) =>
    post<{ decision: unknown }>('/revisiones/decidir-mapa', body),
  file: (lote: string, rel: string) => request<FileDetail>(`/archivo${qs({ lote, rel })}`),
  /** Descarga un KML/KMZ del lote como File (para abrirlo en el editor). */
  fileBlob: async (lote: string, rel: string): Promise<File> => {
    const res = await fetch(`/api/archivo/contenido${qs({ lote, rel })}`);
    if (!res.ok) {
      const t = await res.text();
      let msg = `Error ${res.status}`;
      try {
        msg = JSON.parse(t).error ?? msg;
      } catch {
        /* texto plano */
      }
      throw new ApiError(msg, res.status);
    }
    return new File([await res.blob()], rel.split('/').pop()!);
  },
};

/** Lo que usa la vista del reporte de una ejecución (subconjunto del Report del orquestador). */
export interface JobReport {
  resumen: Record<string, number>;
  trazos: {
    id: string;
    ruta: string;
    tituloMapa: string;
    indice: number;
    rol: string;
    descripcion: string;
    nombreOriginal: string;
    origen: string | null;
    destino: string | null;
    sentido: string;
    estado: string;
    nombreFinal: string | null;
    nombrePropuesto: string | null;
    motivosRevision: string[];
    archivo: string | null;
    metodo: string;
  }[];
  ia: { intervenciones: { titulo: string; ms: number; enCache: boolean; cambios: string[]; explicacion: string; error?: string }[] };
  duplicados: { a: string; b: string; clase: string; similitud: number; tituloA: string; tituloB: string; rutaA: string; rutaB: string }[];
}

export interface FileDetail {
  lote: string;
  rel: string;
  bytes: number;
  modificadoEn: string;
  sha256: string;
  registro: { sha256: string; tipo: string; traza: string; mapa: string; fuente: string; original: string; generadoEn: string; coincide: boolean } | null;
  mapa: { id: string; titulo: string; ruta: string; estado: string; url: string; descargadoEn?: string; error?: string } | null;
  traza: {
    id: string;
    origen: string | null;
    destino: string | null;
    via: string | null;
    sentido: string;
    puntaje: number;
    evidencias: { fuente: string; detalle: string; peso: number }[];
    nombreFinal: string | null;
    nombrePropuesto: string | null;
    motivosRevision: string[];
    metodo: string;
    descripcion: string;
    similitudDupla: { clase: string; similitud: number } | null;
  } | null;
  trazas:
    { id: string; indice: number; descripcion: string; estado: string; nombreFinal: string | null; origen: string | null; destino: string | null }[] | null;
}
