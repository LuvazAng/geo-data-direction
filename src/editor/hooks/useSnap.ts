import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Coord } from '@core';
import type { SnapView } from '../components/RouteCard';
import type { OsmWay } from '../services/overpass';
import { coordsOf, type Route } from '../services/route';
import { fetchStreets, snapToStreets } from '../services/snap';

/** Ajuste a calles en vista previa (uno a la vez). */
interface SnapState {
  id: string;
  /** Cuándo empezó la descarga; también distingue un reintento de la descarga anterior. */
  since: number;
  progress?: { done: number; total: number };
  ways?: OsmWay[];
  error?: string;
}

interface Deps {
  byId: Record<string, Route>;
  selectedId: string | null;
  setGeometry: (id: string, coords: Coord[] | undefined) => void;
  notify: (text: string) => void;
}

/**
 * Ajuste de un trazo a las calles de OpenStreetMap: descarga las calles, calcula el resultado para
 * el margen elegido (que se recuerda entre trazos), lo muestra como vista previa y lo aplica.
 */
export function useSnap({ byId, selectedId, setGeometry, notify }: Deps) {
  const [snap, setSnap] = useState<SnapState | null>(null);
  const [snapDist, setSnapDist] = useState(25);

  // se recalcula al mover el margen o si cambia el trazo (invertir, deshacer…)
  const snapCoords = snap && byId[snap.id] ? coordsOf(byId[snap.id]) : undefined;
  const deferredSnapDist = useDeferredValue(snapDist);
  const snapResult = useMemo(
    () => (snapCoords && snap?.ways ? snapToStreets(snapCoords, snap.ways, deferredSnapDist) : null),
    [snapCoords, snap?.ways, deferredSnapDist],
  );
  const snapView: SnapView | undefined = !snap
    ? undefined
    : snap.error
      ? { state: 'error', message: snap.error, maxDist: snapDist }
      : snapResult
        ? { state: 'ok', result: snapResult, maxDist: snapDist }
        : { state: 'loading', maxDist: snapDist, since: snap.since, progress: snap.progress };
  const snapPreview = useMemo(() => (snapResult ? { coords: snapResult.coords, unmatched: snapResult.unmatched } : null), [snapResult]);

  // La vista previa es sólo del trazo seleccionado
  useEffect(() => {
    if (snap && snap.id !== selectedId) setSnap(null);
  }, [snap, selectedId]);

  /** Descarga las calles alrededor del trazo y abre la vista previa del ajuste. */
  const startSnap = useCallback(
    (id: string) => {
      const r = byId[id];
      if (!r) return;
      const since = Date.now();
      const mine = (s: SnapState | null) => s?.id === id && s.since === since;
      setSnap({ id, since });
      fetchStreets(coordsOf(r), (done, total) => setSnap((s) => (mine(s) ? { ...s!, progress: { done, total } } : s)))
        .then((ways) => setSnap((s) => (mine(s) ? { id, since, ways } : s)))
        .catch((e: Error) => setSnap((s) => (mine(s) ? { id, since, error: e.message } : s)));
    },
    [byId],
  );

  const applySnap = useCallback(() => {
    if (!snap || !snapResult) return;
    setGeometry(snap.id, snapResult.coords);
    setSnap(null);
    notify(`${byId[snap.id]?.letter}: ajustado a calles (${Math.round(snapResult.matched * 100)}%) · Ctrl+Z deshace`);
  }, [snap, snapResult, setGeometry, byId, notify]);

  const cancelSnap = useCallback(() => setSnap(null), []);

  return { snapId: snap?.id, setSnapDist, snapView, snapPreview, startSnap, applySnap, cancelSnap };
}
