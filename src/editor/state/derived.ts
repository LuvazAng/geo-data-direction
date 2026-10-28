import {
  comparePair,
  describedEnds,
  descriptionHint,
  lengthKm,
  organize,
  withVertices,
  type Coord,
  type Organization,
  type PairResult,
  type Relation,
} from '@core';
import { onewayVerdict } from '../services/oneway';
import { baseCoords, coordsOf, endAddr, onewayOf, startAddr, type AddrState, type Route } from '../services/route';
import type { ReviewEditor } from './review';

// Lo que el editor calcula a partir de los trazos (organización, comparaciones, sugerencias, duplas,
// uniones de tramos cortos) como funciones puras: la interfaz sólo las memoriza.

/** Identificador estable por arreglo de coordenadas (para memos baratos). */
const geomIds = new WeakMap<Coord[], number>();
let geomSeq = 0;
const geomId = (c: Coord[]) => {
  let id = geomIds.get(c);
  if (id === undefined) geomIds.set(c, (id = ++geomSeq));
  return id;
};

/** Cambia cuando cambia la geometría, el sentido o la visibilidad de algún trazo: sirve de clave de memo. */
export const geometryKey = (routes: Route[]) => routes.map((r) => `${r.id}:${r.reversed}:${geomId(baseCoords(r))}:${r.visible}`).join('|');

export const addrText = (a?: AddrState) => (a?.state === 'ok' ? a.address : undefined);

/** Roles (principal o tramo corto), duplas y relaciones de los trazos que no son alternas. */
export function organizeRoutes(routes: Route[], tolerance: number): Organization | null {
  const items = routes.filter((r) => !r.alt).map((r) => ({ id: r.id, coords: coordsOf(r), lengthM: lengthKm(coordsOf(r)) * 1000 }));
  return items.length > 0 ? organize(items, tolerance) : null;
}

export interface Pair {
  a: Route;
  b: Route;
  result: PairResult;
}

/** Compara de dos en dos las principales visibles (hasta 4). */
export function comparePairs(routes: Route[], org: Organization | null, tolerance: number): Pair[] {
  const principals = routes.filter((r) => r.visible && !r.alt && org?.role[r.id]?.kind === 'principal').slice(0, 4);
  const out: Pair[] = [];
  for (let i = 0; i < principals.length; i++)
    for (let j = i + 1; j < principals.length; j++)
      out.push({ a: principals[i], b: principals[j], result: comparePair(coordsOf(principals[i]), coordsOf(principals[j]), tolerance) });
  return out;
}

export interface RouteHint {
  ends: ReturnType<typeof describedEnds>;
  hint: ReturnType<typeof descriptionHint>;
}

/** Qué dice la descripción del archivo (ORIGEN-DESTINO) frente a las direcciones de los extremos. */
export function routeHints(routes: Route[], org: Organization | null): Record<string, RouteHint> {
  return Object.fromEntries(
    routes.map((r) => {
      // La descripción habla de la ruta completa: no aplica a un tramo corto
      const ends = org?.role[r.id]?.kind === 'corto' ? null : describedEnds(r.parsed.props, r.source.file.name);
      return [r.id, { ends, hint: descriptionHint(ends, addrText(startAddr(r))?.full, addrText(endAddr(r))?.full) }];
    }),
  );
}

/** Trazos que parecen ir al revés, con lo que lo indica (la descripción y/o las calles de un sentido). */
export function invertSuggestions(routes: Route[], hints: Record<string, RouteHint>): { route: Route; reasons: string[] }[] {
  return routes
    .map((r) => {
      const ow = onewayOf(r);
      const reasons = [hints[r.id]?.hint === 'invertido' && 'la descripción', ow && onewayVerdict(ow) === 'invertido' && 'las calles de un sentido'].filter(
        Boolean,
      ) as string[];
      return { route: r, reasons };
    })
    .filter((s) => s.reasons.length > 0);
}

/** Lo que el mapa necesita de cada trazo. */
export interface MapRoute {
  id: string;
  letter: string;
  color: string;
  coords: Coord[];
  visible: boolean;
  opacity: number;
  /** Tramos que van en contra de calles de un solo sentido. */
  against?: Coord[][];
  /** Tramo corto (se dibuja más delgado). */
  minor?: boolean;
}

export function toMapRoutes(routes: Route[], org: Organization | null): MapRoute[] {
  return routes.map((r) => ({
    id: r.id,
    letter: r.letter,
    color: r.color,
    coords: coordsOf(r),
    visible: r.visible,
    opacity: r.opacity ?? 1,
    minor: org?.role[r.id]?.kind === 'corto',
    against: onewayOf(r)
      ?.stretches.filter((s) => !s.agree)
      .map((s) => s.coords),
  }));
}

/** Número de dupla de cada trazo; una alterna lleva el de su principal. */
export function duplaIndex(org: Organization | null, routes: Route[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const d of org?.duplas ?? []) for (const id of d.ids) m[id] = d.n;
  for (const r of routes) if (r.alt && m[r.alt.mainId] !== undefined) m[r.id] = m[r.alt.mainId];
  return m;
}

/** Alternas ya creadas, como `${principal}:${tramo}`. */
export const createdAlternatives = (routes: Route[]) => new Set(routes.filter((r) => r.alt).map((r) => `${r.alt!.mainId}:${r.alt!.shortId}`));

/**
 * Al evaluar a mano un mapa: dupla (1, 2…) con la que se registra cada trazo que queda. Es la que
 * muestra el editor; un tramo corto va con la principal con la que se relaciona y, si no tiene, aparte.
 */
export function reviewGroupsFor(
  review: ReviewEditor | null,
  routes: Route[],
  duplaOf: Record<string, number>,
  org: Organization | null,
): Map<string, number> | null {
  if (!review?.mapa) return null;
  const kept = routes.filter((r) => !r.alt && review.pendientes.some((t) => t.indice === r.parsed.index));
  let next = Math.max(0, ...kept.map((r) => duplaOf[r.id] ?? 0));
  return new Map(kept.map((r) => [r.id, duplaOf[r.id] ?? (Number(org?.folderOf[r.id]) || ++next)]));
}

// ------------------------------------------------------------------ tramos cortos y sus principales

/** Principal elegida para unir cada tramo corto, y vértices ajustados a mano (`${mainId}:${shortId}`). */
export type AltChoice = Record<string, string>;
export type VertexOverrides = Record<string, { out?: number; in?: number }>;

/** Relación tramo corto ↔ principal, con los vértices de salida / reincorporación ajustados a mano. */
export function relationOf(
  org: Organization | null,
  byId: Record<string, Route>,
  overrides: VertexOverrides,
  shortId: string,
  mainId: string,
): Relation | undefined {
  const rel = org?.relations[shortId]?.find((r) => r.mainId === mainId);
  const main = byId[mainId];
  if (!rel || !main) return undefined;
  const ov = overrides[`${mainId}:${shortId}`];
  return ov ? withVertices(rel, coordsOf(main), ov.out, ov.in) : rel;
}

/** Principal con la que se une cada tramo corto: la elegida o la recomendada. */
export function chosenMainOf(org: Organization | null, altChoice: AltChoice, shortId: string): string | undefined {
  const options = (org?.relations[shortId] ?? []).filter((r) => r.kind !== 'sobre' && r.kind !== 'ninguna');
  return options.find((o) => o.mainId === altChoice[shortId])?.mainId ?? options[0]?.mainId;
}

/** Puntos de salida y reincorporación del tramo corto seleccionado, para marcarlos en el mapa. */
export function junctionPoints(
  selectedId: string | null,
  org: Organization | null,
  byId: Record<string, Route>,
  overrides: VertexOverrides,
  altChoice: AltChoice,
): { coord: Coord; label: string }[] {
  if (!selectedId || !org?.relations[selectedId]) return [];
  const mainId = chosenMainOf(org, altChoice, selectedId);
  const rel = mainId && relationOf(org, byId, overrides, selectedId, mainId);
  if (!rel) return [];
  const letter = byId[mainId!]?.letter;
  const out: { coord: Coord; label: string }[] = [];
  if (rel.outCoord) out.push({ coord: rel.outCoord, label: `sale de ${letter} · vértice ${rel.outVertex}` });
  if (rel.inCoord && rel.kind !== 'lazo')
    out.push({ coord: rel.inCoord, label: `${rel.outCoord ? 'se reincorpora' : 'se incorpora'} a ${letter} · vértice ${rel.inVertex}` });
  return out;
}
