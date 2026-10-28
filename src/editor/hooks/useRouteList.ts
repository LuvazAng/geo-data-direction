import { useCallback, useMemo, useState } from 'react';
import type { Coord } from '@core';
import type { Route } from '../services/route';
import { geometryPatch, invertPatch, undoPatch, type PatchRoute } from '../state/routes';

/** Los trazos abiertos: cuál está seleccionado o en edición, y los cambios básicos de cada uno. */
export function useRouteList() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  /** Trazos en los que encuadrar el mapa; `nonce` fuerza el encuadre aunque sean los mismos. */
  const [fit, setFit] = useState<{ ids: string[]; nonce: number }>({ ids: [], nonce: 0 });

  const patchRoute: PatchRoute = useCallback((id, patch) => {
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)));
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditId((e) => (e === id ? e : null));
  }, []);

  const toggleEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditId((e) => (e === id ? null : id));
  }, []);

  const fitTo = useCallback((ids: string[]) => setFit((f) => ({ ids, nonce: f.nonce + 1 })), []);

  /** Reemplaza los trazos (al cargar archivos), elige uno y encuadra el mapa. */
  const load = useCallback(
    (loaded: Route[], selectIndex?: number) => {
      setRoutes(loaded);
      setSelectedId(loaded.find((r) => r.parsed.index === selectIndex)?.id ?? loaded[0]?.id ?? null);
      fitTo(loaded.map((r) => r.id));
    },
    [fitTo],
  );

  const invert = useCallback((id: string) => patchRoute(id, invertPatch), [patchRoute]);

  /** Cambia la geometría (en el sentido de exportación) guardando la anterior para deshacer. */
  const setGeometry = useCallback((id: string, coords: Coord[] | undefined) => patchRoute(id, (r) => geometryPatch(r, coords)), [patchRoute]);

  const undo = useCallback((id: string) => patchRoute(id, undoPatch), [patchRoute]);

  const byId = useMemo(() => Object.fromEntries(routes.map((r) => [r.id, r])), [routes]);

  return { routes, setRoutes, selectedId, editId, setEditId, fit, patchRoute, select, toggleEdit, fitTo, load, invert, setGeometry, undo, byId };
}
