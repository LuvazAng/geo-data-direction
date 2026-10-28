// Eventos que emite el orquestador mientras trabaja. Los consume la CLI (como texto) y el
// servidor del centro de control (consola, etapas, archivos). Sin dependencias de Node: el
// frontend importa estos tipos.

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type Component = 'ORCHESTRATOR' | 'SOURCE' | 'DOWNLOAD' | 'GEOMETRY' | 'CLASSIFY' | 'QWEN' | 'OUTPUT' | 'FS' | 'PI-CLI' | 'BACKEND';

export const COMPONENTS: Component[] = ['ORCHESTRATOR', 'SOURCE', 'DOWNLOAD', 'GEOMETRY', 'CLASSIFY', 'QWEN', 'OUTPUT', 'FS', 'PI-CLI', 'BACKEND'];

/** Etapas del orquestador, en orden. */
export type Stage = 'fuente' | 'descarga' | 'analisis' | 'clasificacion' | 'comparacion' | 'ia' | 'nombres' | 'salida' | 'reporte';

export const STAGES: Stage[] = ['fuente', 'descarga', 'analisis', 'clasificacion', 'comparacion', 'ia', 'nombres', 'salida', 'reporte'];

export type FileState =
  | 'detectado'
  | 'descargando'
  | 'descargado'
  | 'ya-estaba'
  | 'error'
  | 'analizado'
  | 'generado'
  | 'actualizado'
  | 'sin-cambios'
  | 'revision'
  | 'obsoleto'
  | 'conflicto';

export type PipelineEvent =
  | { tipo: 'log'; nivel: Level; componente: Component; mensaje: string; ruta?: string; mapa?: string; duracionMs?: number; datos?: Record<string, unknown> }
  | { tipo: 'etapa'; etapa: Stage }
  | { tipo: 'progreso'; etapa: Stage; hechos: number; total: number }
  | { tipo: 'archivo'; estado: FileState; ruta: string; mapa?: string; rel?: string; detalle?: string };

export type Emit = (e: PipelineEvent) => void;

/** Ayudante para emitir sin repetir campos. */
export function emitter(emit: Emit | undefined) {
  const e: Emit = emit ?? (() => {});
  const log = (
    nivel: Level,
    componente: Component,
    mensaje: string,
    extra: Omit<Extract<PipelineEvent, { tipo: 'log' }>, 'tipo' | 'nivel' | 'componente' | 'mensaje'> = {},
  ) => e({ tipo: 'log', nivel, componente, mensaje, ...extra });
  return {
    emit: e,
    info: (c: Component, m: string, x?: Parameters<typeof log>[3]) => log('INFO', c, m, x),
    warn: (c: Component, m: string, x?: Parameters<typeof log>[3]) => log('WARN', c, m, x),
    error: (c: Component, m: string, x?: Parameters<typeof log>[3]) => log('ERROR', c, m, x),
    debug: (c: Component, m: string, x?: Parameters<typeof log>[3]) => log('DEBUG', c, m, x),
    stage: (etapa: Stage) => e({ tipo: 'etapa', etapa }),
    progress: (etapa: Stage, hechos: number, total: number) => e({ tipo: 'progreso', etapa, hechos, total }),
    file: (estado: FileState, ruta: string, extra: { mapa?: string; rel?: string; detalle?: string } = {}) => e({ tipo: 'archivo', estado, ruta, ...extra }),
  };
}

/** Texto de una línea para la CLI. */
export function formatEvent(e: PipelineEvent): string | null {
  if (e.tipo === 'log') return `${e.nivel === 'INFO' ? '' : `[${e.nivel}] `}[${e.componente}] ${e.ruta ? `${e.ruta} · ` : ''}${e.mensaje}`;
  if (e.tipo === 'etapa') return `— ${e.etapa}`;
  return null;
}
