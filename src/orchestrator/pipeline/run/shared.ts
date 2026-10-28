import type { TraceDecision } from '../../domain/classify';

/** Sentidos que se dan por buenos sin revisión humana. */
export const OK_SENTIDOS = new Set(['confirmado', 'inferido', 'circuito']);

/** Cede el turno al resto del proceso (servidor del centro) entre bloques de cálculo. */
export const breathe = () => new Promise<void>((r) => setImmediate(r));

/** Un itinerario principal, no duplicado, con sentido confirmado y sin motivos de revisión. */
export const isOk = (d: TraceDecision) => d.role === 'principal' && !d.duplicadoDe && OK_SENTIDOS.has(d.sentido) && d.revision.length === 0;
