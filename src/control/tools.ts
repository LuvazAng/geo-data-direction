// Cuándo se puede usar cada herramienta del centro de control. Ninguna se oculta: si no aplica, se dice por qué.
import type { ToolStatus } from '@ui';

/** Lo que el centro sabe en este momento. */
export interface ControlFacts {
  online: boolean;
  /** Hay una acción en curso (se esperan sus resultados). */
  busy: boolean;
  paused: boolean;
  /** Ejecuciones esperando en la cola. */
  pending: number;
}

export const OFFLINE = 'Sin conexión con el servidor del centro. Ábrelo con «npm run centro».';

const ready: ToolStatus = { status: 'ready' };
const off = (reason: string): ToolStatus => ({ status: 'off', reason });

export interface ControlToolStates {
  pause: ToolStatus;
  runNext: ToolStatus;
  newChat: ToolStatus;
  /** Por lote: cuántas rutas se conocen de él decide si hay qué encolar o si falta leer la fuente. */
  updateSource: Record<string, ToolStatus>;
  enqueuePending: Record<string, ToolStatus>;
}

export function controlToolStates(f: ControlFacts, routesPerLote: Record<string, number>): ControlToolStates {
  const lotes = Object.keys(routesPerLote);
  return {
    pause: f.online ? ready : off(OFFLINE),
    runNext: !f.online ? off(OFFLINE) : f.pending === 0 ? off('No hay ejecuciones esperando en la cola.') : ready,
    newChat: !f.online ? off(OFFLINE) : f.busy ? off('Espera a que termine lo que se está haciendo.') : ready,
    updateSource: Object.fromEntries(
      lotes.map((l) => [
        l,
        !f.online ? off(OFFLINE) : routesPerLote[l] === 0 ? { status: 'recommended', why: 'Este lote todavía no tiene su fuente leída.' } : ready,
      ]),
    ),
    enqueuePending: Object.fromEntries(
      lotes.map((l) => [
        l,
        !f.online ? off(OFFLINE) : routesPerLote[l] === 0 ? off('Primero actualiza la fuente de este lote: todavía no se conocen sus rutas.') : ready,
      ]),
    ),
  };
}
