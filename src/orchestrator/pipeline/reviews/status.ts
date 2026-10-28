import type { Report } from '../report';
import { Workspace, setEstado, type BatchState } from '../../io/store';
import type { TraceRow } from '@protocol';
import type { ReviewStore } from './store';

// Estado de cada mapa: generado, en revisión, descartado o sin itinerarios utilizables.

const ROLE_COUNT: [TraceRow['rol'], string][] = [
  ['ampliacion', 'ampliación(es)'],
  ['tramo', 'tramo(s) corto(s)'],
  ['base', 'trazo(s) de base'],
  ['otro', 'trazo(s) sin identificar'],
];

/** Por qué un mapa no tiene itinerarios propios (ayuda a decidir si se evalúa a mano o se descarta). */
function withoutItinerariesReason(rows: TraceRow[], mapa: string): string {
  const own = rows.filter((r) => r.mapa === mapa);
  const title = (pred: (r: TraceRow) => boolean) => rows.find(pred)?.tituloMapa ?? '?';
  const parts = [
    ...new Set(
      own.flatMap((r) =>
        r.duplicadoDe
          ? [`copia de «${title((x) => x.id === r.duplicadoDe)}»`]
          : r.rol === 'principal'
            ? [`asignado a «${title((x) => x.mapa === r.mapaAsignado)}»`]
            : [],
      ),
    ),
    ...ROLE_COUNT.flatMap(([rol, text]) => {
      const n = own.filter((r) => r.rol === rol && !r.duplicadoDe).length;
      return n ? [`${n} ${text}`] : [];
    }),
  ];
  return `sin itinerarios utilizables: ${parts.length ? parts.join(', ') : 'el mapa no tiene trazos'}`;
}

/**
 * Estado de un mapa analizado: descartado a mano, sin itinerarios (con el motivo), en revisión o
 * generado. Cuentan sus itinerarios del pipeline y los trazos de su archivo evaluados a mano.
 */
export function mapStatus(rows: TraceRow[], mapa: string, descartado: boolean): { estado: 'GENERADO' | 'REQUIERE_REVISION' | 'DESCARTADO'; error?: string } {
  if (descartado) return { estado: 'DESCARTADO' };
  const mine = rows.filter(
    (r) => (r.mapaAsignado === mapa && r.rol === 'principal' && !r.duplicadoDe) || (r.mapa === mapa && r.resolucionManual?.grupoMapa !== undefined),
  );
  if (!mine.length) return { estado: 'REQUIERE_REVISION', error: withoutItinerariesReason(rows, mapa) };
  return { estado: mine.some((r) => r.estado === 'REQUIERE_REVISION') ? 'REQUIERE_REVISION' : 'GENERADO' };
}

/** Mapa sin itinerarios y sin ninguna decisión: nada de su archivo está pendiente, generado ni resuelto. */
export function undecidedWithoutItineraries(report: Report, reviews: ReviewStore, state: BatchState | null, mapa: string): boolean {
  if (state?.mapas[mapa]?.estado !== 'REQUIERE_REVISION' || reviews.mapas?.[mapa]) return false;
  return (
    mapStatus(report.trazos, mapa, false).error !== undefined &&
    report.trazos.every((t) => t.mapa !== mapa || (t.estado === 'NO_SE_GENERA' && !reviews.decisiones[t.id]))
  );
}

export function updateMapStates(ws: Workspace, report: Report, reviews: ReviewStore) {
  const state = ws.readJson<BatchState | null>(['estado.json'], null);
  if (!state) return;
  for (const map of report.mapas) {
    const s = state.mapas[map.id];
    // sólo los mapas ya procesados; los que tienen error (o no se han analizado) se quedan como están
    if (!s || !['GENERADO', 'REQUIERE_REVISION', 'DESCARTADO'].includes(s.estado)) continue;
    const next = mapStatus(report.trazos, map.id, !!reviews.mapas?.[map.id]);
    if (s.estado !== next.estado || s.error !== next.error) setEstado(s, next.estado, next.error ? { error: next.error } : {});
    map.estado = next.estado;
    map.error = next.error;
  }
  const mapStates = Object.values(state.mapas);
  report.resumen.mapasGenerados = mapStates.filter((m) => m.estado === 'GENERADO').length;
  report.resumen.mapasEnRevision = mapStates.filter((m) => m.estado === 'REQUIERE_REVISION').length;
  report.resumen.mapasDescartados = mapStates.filter((m) => m.estado === 'DESCARTADO').length;
  report.resumen.generados = report.trazos.filter((t) => t.estado === 'GENERADO').length;
  report.resumen.requierenRevision = report.trazos.filter((t) => t.estado === 'REQUIERE_REVISION').length;
  ws.writeJson(['estado.json'], state);
}
