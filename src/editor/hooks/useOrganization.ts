import { useCallback, useMemo, useState } from 'react';
import type { Route } from '../services/route';
import {
  comparePairs,
  createdAlternatives,
  duplaIndex,
  geometryKey,
  invertSuggestions,
  junctionPoints,
  organizeRoutes,
  relationOf,
  reviewGroupsFor,
  routeHints,
  toMapRoutes,
  type AltChoice,
  type VertexOverrides,
} from '../state/derived';
import type { ReviewEditor } from '../state/review';

interface Deps {
  routes: Route[];
  byId: Record<string, Route>;
  tolerance: number;
  selectedId: string | null;
  reviewEditor: ReviewEditor | null;
}

/**
 * Lo que el editor deduce de los trazos: roles y duplas, comparaciones, sugerencias de invertir y
 * cómo se unen los tramos cortos a su principal (con lo que el usuario elige o ajusta a mano).
 */
export function useOrganization({ routes, byId, tolerance, selectedId, reviewEditor }: Deps) {
  /** Principal elegida para unir cada tramo corto, y vértices ajustados a mano (`${mainId}:${shortId}`). */
  const [altChoice, setAltChoice] = useState<AltChoice>({});
  const [vertexOverrides, setVertexOverrides] = useState<VertexOverrides>({});

  const geomKey = geometryKey(routes);

  const org = useMemo(
    () => organizeRoutes(routes, tolerance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geomKey, tolerance],
  );

  const pairs = useMemo(
    () => comparePairs(routes, org, tolerance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geomKey, tolerance, org],
  );

  const hints = useMemo(() => routeHints(routes, org), [routes, org]);

  const suggestions = invertSuggestions(routes, hints);

  const mapRoutes = useMemo(() => toMapRoutes(routes, org), [routes, org]);

  const createdAlts = useMemo(() => createdAlternatives(routes), [routes]);
  const duplaOf = useMemo(() => duplaIndex(org, routes), [org, routes]);

  const reviewGroups = useMemo(() => reviewGroupsFor(reviewEditor, routes, duplaOf, org), [reviewEditor, routes, duplaOf, org]);

  const relationFor = useCallback((shortId: string, mainId: string) => relationOf(org, byId, vertexOverrides, shortId, mainId), [org, byId, vertexOverrides]);

  // Al seleccionar un tramo corto se marcan en el mapa sus puntos de salida y reincorporación
  const junctions = useMemo(() => junctionPoints(selectedId, org, byId, vertexOverrides, altChoice), [selectedId, org, byId, vertexOverrides, altChoice]);

  const chooseMain = useCallback((shortId: string, mainId: string) => setAltChoice((c) => ({ ...c, [shortId]: mainId })), []);

  const setVertex = useCallback(
    (shortId: string, mainId: string, which: 'out' | 'in', vertex: number) =>
      setVertexOverrides((o) => {
        const key = `${mainId}:${shortId}`;
        return { ...o, [key]: { ...o[key], [which]: vertex } };
      }),
    [],
  );

  /** Olvida lo elegido a mano (al cargar otros trazos). */
  const reset = useCallback(() => {
    setAltChoice({});
    setVertexOverrides({});
  }, []);

  return { org, pairs, hints, suggestions, mapRoutes, createdAlts, duplaOf, reviewGroups, relationFor, junctions, altChoice, chooseMain, setVertex, reset };
}
