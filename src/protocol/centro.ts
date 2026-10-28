// Contrato entre el servidor del centro de control y el frontend. Sólo tipos y constantes, sin
// dependencias de Node: lo importan ambos lados.

import type { Component, FileState, Level, Stage } from './events';

export type { Component, FileState, Level, Stage };

// ---------------------------------------------------------------------------
// Ejecuciones (jobs)
// ---------------------------------------------------------------------------

/**
 * Estado de una ejecución. Las etapas del orquestador (en el orden en que corren) se agrupan en
 * EN_DESCARGA (fuente, descarga), EN_ANALISIS (análisis), EN_CLASIFICACION (clasificación,
 * comparación con otras rutas, Qwen, nombres) y EN_GENERACION (salida, reporte).
 */
export type JobStatus =
  | 'PENDIENTE'
  | 'EN_DESCARGA'
  | 'EN_ANALISIS'
  | 'EN_CLASIFICACION'
  | 'EN_GENERACION'
  | 'COMPLETADO'
  | 'COMPLETADO_CON_ADVERTENCIAS'
  | 'FALLIDO'
  | 'CANCELADO'
  /** El servidor se detuvo mientras corría: no se reanuda sola, se puede reintentar. */
  | 'INTERRUMPIDO';

export const ACTIVE: JobStatus[] = ['EN_DESCARGA', 'EN_ANALISIS', 'EN_CLASIFICACION', 'EN_GENERACION'];
export const FINISHED: JobStatus[] = ['COMPLETADO', 'COMPLETADO_CON_ADVERTENCIAS', 'FALLIDO', 'CANCELADO', 'INTERRUMPIDO'];

export const STATUS_OF_STAGE: Record<Stage, JobStatus> = {
  fuente: 'EN_DESCARGA',
  descarga: 'EN_DESCARGA',
  analisis: 'EN_ANALISIS',
  comparacion: 'EN_CLASIFICACION',
  clasificacion: 'EN_CLASIFICACION',
  ia: 'EN_CLASIFICACION',
  nombres: 'EN_CLASIFICACION',
  salida: 'EN_GENERACION',
  reporte: 'EN_GENERACION',
};

/** Unidad de trabajo: la subpágina de una ruta (la misma unidad que usa el orquestador), o la fuente completa. */
export type JobUnit = { tipo: 'ruta'; slug: string; titulo: string } | { tipo: 'fuente' };

export interface JobParams {
  sinRed: boolean;
  refrescar: boolean;
  sinIa: boolean;
}

export interface JobFile {
  rel: string;
  tipo: 'original' | 'resultado' | 'revision';
  estado: string;
}

export interface Job {
  id: string;
  lote: string;
  unidad: JobUnit;
  estado: JobStatus;
  etapa: Stage | null;
  parametros: JobParams;
  creadoEn: string;
  encoladoEn: string;
  iniciadoEn?: string;
  finalizadoEn?: string;
  /** Duración de cada etapa (ms), tal como la midió el orquestador. */
  tiempos: Partial<Record<Stage, number>>;
  /** Avance sólo cuando se puede contar de verdad (mapas descargados de N). */
  progreso?: { etapa: Stage; hechos: number; total: number };
  intento: number;
  reintentoDe?: string;
  resultado?: {
    mapas: number;
    mapasConError: number;
    trazos: number;
    generados: number;
    revision: number;
    reporte: string;
  };
  archivosEntrada: string[];
  archivosSalida: JobFile[];
  errores: string[];
  advertencias: string[];
  cancelacionSolicitada?: boolean;
  /** Para no crear la misma ejecución dos veces si el navegador repite la petición. */
  claveIdempotencia?: string;
  origen: 'chat' | 'cola' | 'api';
}

export interface QueueState {
  /** Ids de las ejecuciones pendientes, en el orden en que se van a tomar. */
  orden: string[];
  pausada: boolean;
  maxSimultaneas: number;
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Secuencia creciente dentro de la instancia del servidor. */
  seq: number;
  ts: string;
  nivel: Level;
  componente: Component;
  mensaje: string;
  jobId?: string;
  lote?: string;
  ruta?: string;
  mapa?: string;
  duracionMs?: number;
  datos?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Rutas (unidades disponibles) y archivos
// ---------------------------------------------------------------------------

export type RouteStatus = 'sin-procesar' | 'procesada' | 'con-revision' | 'con-errores' | 'incompleta';

export interface RouteUnit {
  lote: string;
  slug: string;
  titulo: string;
  mapas: number;
  estado: RouteStatus;
  conteo: Record<string, number>;
  /** Ejecución pendiente o en curso para esta ruta, si la hay. */
  jobActivo?: string;
  ultimoJob?: string;
}

export type FileView = {
  rel: string;
  nombre: string;
  tipo: 'original' | 'resultado' | 'revision';
  /** Estado según el estado del lote y el manifiesto, no según si el archivo aparece en la carpeta. */
  estado: 'pendiente' | 'descargado' | 'en-proceso' | 'analizado' | 'generado' | 'revision' | 'error' | 'falta' | 'modificado' | 'no-registrado';
  bytes?: number;
  traza?: string;
  detalle?: string;
};

export interface MapView {
  id: string;
  orden: number;
  titulo: string;
  estado: string;
  error?: string;
  original: FileView | null;
  salidas: FileView[];
}

export interface FolderView {
  lote: string;
  slug: string;
  titulo: string;
  carpeta: string;
  mapas: MapView[];
}

export interface FilesSnapshot {
  lote: string;
  raiz: string;
  rutas: FolderView[];
  /** Archivos en resultados/ que el manifiesto no registra (copiados o editados a mano). */
  noRegistrados: string[];
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Acciones que el chat (o un botón) puede pedir. El servidor no ejecuta nada fuera de esta lista. */
export type Action =
  | { tipo: 'encolar'; lote: string; ruta: string; primero?: boolean; iniciar?: boolean }
  | { tipo: 'encolar-pendientes'; lote: string }
  | { tipo: 'actualizar-fuente'; lote: string }
  | { tipo: 'mover-primero'; jobId: string }
  | { tipo: 'iniciar'; jobId: string }
  | { tipo: 'ejecutar-siguiente' }
  | { tipo: 'reintentar'; jobId: string }
  | { tipo: 'cancelar'; jobId: string }
  | { tipo: 'pausar' }
  | { tipo: 'reanudar' }
  | { tipo: 'detalle-ejecucion'; jobId: string }
  | { tipo: 'detalle-ruta'; lote: string; ruta: string }
  | { tipo: 'explicar-con-pi'; jobId: string };

export const ACTION_TYPES = [
  'encolar',
  'encolar-pendientes',
  'actualizar-fuente',
  'mover-primero',
  'iniciar',
  'ejecutar-siguiente',
  'reintentar',
  'cancelar',
  'pausar',
  'reanudar',
  'detalle-ejecucion',
  'detalle-ruta',
  'explicar-con-pi',
] as const;

export type ChatBlock =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'lista'; titulo?: string; items: { texto: string; detalle?: string; estado?: string }[] }
  | { tipo: 'opciones'; titulo?: string; opciones: { etiqueta: string; accion: Action; peligrosa?: boolean }[] }
  | { tipo: 'ejecucion'; jobId: string }
  | { tipo: 'archivos'; titulo?: string; lote: string; items: { rel: string; tipo: string; detalle?: string }[] }
  /** Frases de ejemplo: al elegir una se envía como mensaje (no ejecuta nada por sí misma). */
  | { tipo: 'sugerencias'; items: string[] }
  | { tipo: 'ruta'; lote: string; ruta: string }
  | { tipo: 'error'; texto: string };

/** Cuánto puede razonar Qwen antes de responder. */
export type Esfuerzo = 'ninguno' | 'bajo' | 'medio' | 'alto';
export const ESFUERZOS: Esfuerzo[] = ['ninguno', 'bajo', 'medio', 'alto'];
/**
 * Tokens de razonamiento de cada nivel. Al agotarlos, se corta el razonamiento y se le pide a Qwen
 * que responda con lo que ya pensó (así nunca se queda sin respuesta por razonar de más).
 */
export const PRESUPUESTO_RAZONAMIENTO: Record<Esfuerzo, number> = { ninguno: 0, bajo: 256, medio: 1024, alto: 3072 };

/** Una conversación del chat: Qwen sólo relee los mensajes de la conversación en la que se le pregunta. */
export interface Conversacion {
  id: string;
  titulo: string;
  creadaEn: string;
  actualizadaEn: string;
  /** Mensajes terminados guardados en la conversación. */
  mensajes: number;
}

/** Los mensajes de antes de que hubiera conversaciones quedan en esta. */
export const CONVERSACION_ANTERIOR = 'c-anterior';

/** Respuesta conversacional de Qwen: lo que entregó el runtime, tal cual (texto para leer, nunca una orden). */
export interface QwenTurn {
  modelo: string;
  /** Si se le pidió razonar antes de responder (think de Ollama). */
  pensar: boolean;
  esfuerzo?: Esfuerzo;
  /** Tokens de razonamiento permitidos (según el esfuerzo). */
  presupuesto?: number;
  /** El razonamiento llegó al presupuesto y se le pidió responder con lo que ya había pensado. */
  recortado?: boolean;
  /** Desde que el modelo recibió la petición hasta su primer token (carga y lectura del contexto). */
  primerTokenMs?: number;
  fase: 'esperando' | 'cargando' | 'pensando' | 'respondiendo' | 'listo' | 'detenido' | 'error';
  /** Razonamiento que el modelo escribió antes de responder (sólo con pensar). */
  razonamiento?: string;
  ms?: number;
  /** Tiempo que Ollama tardó en cargar el modelo (si no estaba cargado). */
  cargaMs?: number;
  tokens?: { entrada?: number; salida?: number };
  tokPorSeg?: number;
  /** done_reason de Ollama: "stop" o "length" (cortado por longitud). */
  motivo?: string;
}

export interface ChatMessage {
  id: string;
  ts: string;
  rol: 'usuario' | 'sistema' | 'qwen';
  texto: string;
  bloques: ChatBlock[];
  /** Cómo se entendió el mensaje: por reglas, con Qwen, o una acción de botón. */
  interpretacion?: { intencion: string; via: 'reglas' | 'qwen' | 'boton'; ms?: number };
  /** Respuesta en curso (Pi o Qwen escribiendo); se reemplaza al terminar. */
  parcial?: boolean;
  /** Versión de un mensaje que se actualiza en vivo: el navegador no reemplaza una versión por otra más vieja. */
  rev?: number;
  qwen?: QwenTurn;
  /** Conversación a la que pertenece (sin ella: CONVERSACION_ANTERIOR). */
  conversacion?: string;
}

/**
 * Lo nuevo de un mensaje que se está escribiendo (Qwen en streaming): el navegador lo agrega al
 * final de lo que ya tiene. Sólo vale sobre la versión inmediatamente anterior (`rev` - 1); si se
 * perdió un trozo, se espera la siguiente versión completa (chat.message).
 */
export interface ChatDelta {
  id: string;
  rev: number;
  fase?: QwenTurn['fase'];
  texto?: string;
  razonamiento?: string;
}

/** Opciones de cada mensaje del chat. */
export interface ChatOptions {
  /** Conversación en la que se escribe (por omisión, la más reciente). */
  conversacion?: string;
  /** Qwen responde en texto además del centro (por omisión, sí). */
  conversar?: boolean;
  /** Cuánto razona Qwen antes de responder (por omisión, bajo). */
  esfuerzo?: Esfuerzo;
}

// ---------------------------------------------------------------------------
// Estado de los modelos
// ---------------------------------------------------------------------------

export interface ModelInfo {
  qwen: {
    modelo: string;
    url: string;
    actual: { origen: string; tarea: string; desde: string } | null;
    enEspera: number;
    ultima: { origen: string; tarea: string; desde: string; hasta: string; ms: number; ok: boolean; detalle?: string } | null;
    cargados?: { name: string; size: number; size_vram?: number; expires_at?: string }[];
    error?: string;
  };
  pi: {
    disponible: boolean;
    detalle: string;
    version?: string;
    enCurso: { jobId: string; desde: string; pid?: number } | null;
    ultima: { jobId: string; desde: string; hasta: string; ms: number; codigo: number | null; ok: boolean } | null;
  };
}

// ---------------------------------------------------------------------------
// Eventos (SSE)
// ---------------------------------------------------------------------------

export interface Snapshot {
  servidor: { inicio: string; bootId: string; version: string };
  lotes: { lote: string; zona: string; fuente: string; raiz: string }[];
  cola: QueueState;
  jobs: Job[];
  rutas: RouteUnit[];
  logs: LogEntry[];
  modelos: ModelInfo;
  conversaciones: Conversacion[];
}

export type ServerEvent =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'job.created'; data: Job }
  | { type: 'job.queued'; data: Job }
  | { type: 'job.started'; data: Job }
  | { type: 'job.stage_changed'; data: Job }
  | { type: 'job.progress'; data: Job }
  | { type: 'job.log'; data: LogEntry }
  | { type: 'job.file_detected'; data: { jobId: string; lote: string; ruta: string; mapa?: string; rel?: string; estado: FileState; detalle?: string } }
  | { type: 'job.file_updated'; data: { jobId: string; lote: string; ruta: string; mapa?: string; rel?: string; estado: FileState; detalle?: string } }
  | { type: 'job.completed'; data: Job }
  | { type: 'job.failed'; data: Job }
  | { type: 'job.cancelled'; data: Job }
  | { type: 'queue.updated'; data: QueueState }
  | { type: 'routes.updated'; data: RouteUnit[] }
  | { type: 'folder.updated'; data: { lote: string; rutas: string[]; motivo: string } }
  | { type: 'chat.message'; data: ChatMessage }
  | { type: 'chat.delta'; data: ChatDelta }
  | { type: 'chat.conversation'; data: Conversacion }
  | { type: 'models.updated'; data: ModelInfo };

export type ServerEventType = ServerEvent['type'];
