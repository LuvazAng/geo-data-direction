import type { Emit } from '@protocol';
import type { HttpClient } from '../../io/http';
import type { BatchState } from '../../io/store';
import type { QwenClient } from '../../llm/llm';
import type { Report } from '../report';

export interface RunOptions {
  sinRed?: boolean;
  refrescar?: boolean;
  soloDescarga?: boolean;
  /** Sólo actualizar la fuente (páginas y mapas), sin descargar ni procesar. */
  soloFuente?: boolean;
  /**
   * Ejecución parcial: subpáginas (rutas) a procesar. Se clasifica todo el lote como contexto
   * (los nombres y códigos no cambian según lo que se elija), pero sólo se descargan, se consultan
   * a Qwen y se escriben los archivos de estas rutas.
   */
  scope?: string[];
  /** Dónde escribir además el reporte de esta ejecución (relativo al lote), p. ej. ['ejecuciones', id]. */
  reportDir?: string[];
  /** Quién toma el candado del lote (aparece si otro proceso intenta usarlo). */
  owner?: string;
  log?: (s: string) => void;
  emit?: Emit;
  /** Cancelación cooperativa: se revisa entre etapas y entre mapas; nunca durante la escritura de resultados. */
  signal?: AbortSignal;
  /** Para pruebas: cliente HTTP y de IA simulados. */
  http?: HttpClient;
  qwen?: QwenClient;
}

export interface RunResult {
  reportePath: string;
  report: Report;
  state: BatchState;
  /** Resumen de lo que abarcó la ejecución (todo el lote o el `scope`). */
  resumen: RunSummary;
}

export interface RunSummary {
  rutas: string[];
  mapas: number;
  mapasConError: number;
  trazos: number;
  generados: number;
  revision: number;
  archivos: { rel: string; tipo: 'resultado' | 'revision'; estado: 'nuevo' | 'actualizado' | 'sin-cambios' }[];
  obsoletos: string[];
  conflictos: { rel: string; motivo: string }[];
  errores: string[];
  advertencias: string[];
}

export type Validation = 'coincide' | 'difiere' | 'no-verificable' | 'sin-decision' | 'sin-equivalente';
