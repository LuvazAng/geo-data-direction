import type { Route } from '../services/route';

// Revisión de un mapa del orquestador en el editor: qué trazos quedan, cuáles se eliminaron, qué se le
// manda al servidor y qué se le dice a quien edita.

/** Mapa del orquestador que se está resolviendo a mano en el editor. */
export interface ReviewEditor {
  lote: string;
  totalTrazos: number;
  pendientes: { traza: string; indice: number; nombre?: string }[];
  /** Mapa sin itinerarios que se evalúa a mano: se registra lo que quede, agrupado por dupla. */
  mapa?: string;
}

export type PendingTrace = ReviewEditor['pendientes'][number];

export interface PendingSplit {
  /** Trazos del original que siguen en el editor, por su posición en el archivo. */
  routesByIndex: Map<number, Route>;
  kept: PendingTrace[];
  /** Pendientes que se eliminaron del editor (p. ej. para dejar sólo ida y regreso): se descartan. */
  removed: PendingTrace[];
}

export function splitPending(review: ReviewEditor, routes: Route[]): PendingSplit {
  // las alternas creadas en el editor no son trazos del original
  const routesByIndex = new Map(routes.filter((route) => !route.alt).map((route) => [route.parsed.index, route]));
  return {
    routesByIndex,
    kept: review.pendientes.filter((trace) => routesByIndex.has(trace.indice)),
    removed: review.pendientes.filter((trace) => !routesByIndex.has(trace.indice)),
  };
}

/** Duplas que se registrarán al evaluar el mapa a mano, con las letras de sus trazos. */
export const duplasWithLetters = (groups: Map<string, number> | null, byId: Record<string, Route>) =>
  [...(groups ?? [])].reduce((acc, [id, n]) => acc.set(n, [...(acc.get(n) ?? []), byId[id]?.letter ?? '?']), new Map<number, string[]>());

type ContentFor = (route: Route) => string;

/** Petición para registrar un mapa sin itinerarios evaluado a mano: lo que queda, por dupla; lo eliminado se descarta. */
export function evaluateMapRequest(review: ReviewEditor & { mapa: string }, split: PendingSplit, groups: Map<string, number>, contentFor: ContentFor) {
  return {
    lote: review.lote,
    mapa: review.mapa,
    generar: split.kept.map((trace) => {
      const route = split.routesByIndex.get(trace.indice)!;
      return {
        traza: trace.traza,
        nombre: route.outName,
        contenidoKml: contentFor(route),
        dupla: groups.get(route.id)!,
        nota: `Mapa evaluado a mano; trazo ${trace.indice + 1}`,
      };
    }),
    descartar: split.removed.map((trace) => ({ traza: trace.traza, nota: `Eliminado en el editor al evaluar el mapa; trazo ${trace.indice + 1}` })),
  };
}

/** Petición para resolver los conflictos de un mapa: un KML por trazo que queda; lo eliminado se descarta. */
export function resolveReviewsRequest(review: ReviewEditor, split: PendingSplit, contentFor: ContentFor) {
  return {
    lote: review.lote,
    items: [
      ...split.kept.map((trace) => {
        const route = split.routesByIndex.get(trace.indice)!;
        return {
          traza: trace.traza,
          nombre: route.outName,
          contenidoKml: contentFor(route),
          nota: `Geometría editada en el mapa; trazo ${trace.indice + 1}`,
        };
      }),
      ...split.removed.map((trace) => ({
        accion: 'descartar' as const,
        traza: trace.traza,
        nota: `Eliminado en el editor al resolver el mapa; trazo ${trace.indice + 1}`,
      })),
    ],
  };
}

/** Aviso cuando se eliminaron todos los trazos y no queda nada que registrar. */
export const nothingLeftMessage = (review: ReviewEditor) =>
  review.mapa
    ? 'Eliminaste todos los trazos; si el mapa no tiene nada que generar, descártalo desde el centro de control.'
    : 'Eliminaste todos los trazos pendientes; para descartarlos usa el centro de control.';

/** Aviso al terminar: `duplas` sólo cuenta al evaluar un mapa sin itinerarios. */
export const reviewDoneMessage = (review: ReviewEditor, kept: number, removed: number, duplas: number) =>
  (review.mapa ? `Mapa evaluado: ${kept} KML en ${duplas} dupla(s)` : `Conflictos resueltos: ${kept} KML individuales generados`) +
  (removed ? `; ${removed} trazo(s) eliminado(s) quedaron descartados` : '');
