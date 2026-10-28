import { useCallback, useEffect } from 'react';
import type { Coord } from '@core';
import { reverseGeocode } from '../services/geocode';
import { evaluateOneways, fetchOneways } from '../services/oneway';
import { baseCoords, type Route } from '../services/route';
import { sameCoord, type PatchRoute } from '../state/routes';

/**
 * Datos que se piden por cada trazo: la dirección de su primer y último punto y las calles de un
 * sentido por las que pasa. Cada vez que cambia la geometría (carga, edición, guardado) se recalculan.
 */
export function useRouteInfo(routes: Route[], patchRoute: PatchRoute) {
  const geocode = useCallback(
    (id: string, which: 'addrFirst' | 'addrLast', coord: Coord) => {
      const stillThere = (r: Route) => {
        const b = baseCoords(r);
        return sameCoord(which === 'addrFirst' ? b[0] : b[b.length - 1], coord);
      };
      reverseGeocode(coord)
        .then((address) => patchRoute(id, (cur) => (stillThere(cur) ? { [which]: { state: 'ok', address } } : {})))
        .catch((e: Error) => patchRoute(id, (cur) => (stillThere(cur) ? { [which]: { state: 'error', message: e.message } } : {})));
    },
    [patchRoute],
  );

  const checkOneways = useCallback(
    (id: string, base: Coord[]) => {
      fetchOneways(base)
        .then((ways) => {
          const result = evaluateOneways(base, ways);
          patchRoute(id, (cur) => (baseCoords(cur) === base ? { oneway: { state: 'ok', result, base } } : {}));
        })
        .catch((e: Error) => patchRoute(id, (cur) => (baseCoords(cur) === base ? { oneway: { state: 'error', message: e.message } } : {})));
    },
    [patchRoute],
  );

  useEffect(() => {
    for (const r of routes) {
      const base = baseCoords(r);
      if (r.derivedFor === base) continue;
      const prev = r.derivedFor;
      const first = base[0];
      const last = base[base.length - 1];
      const firstChanged = !sameCoord(prev?.[0], first);
      const lastChanged = !sameCoord(prev?.[prev.length - 1], last);
      patchRoute(r.id, {
        derivedFor: base,
        ...(firstChanged && { addrFirst: { state: 'loading' } }),
        ...(lastChanged && { addrLast: { state: 'loading' } }),
      });
      if (firstChanged) geocode(r.id, 'addrFirst', first);
      if (lastChanged) geocode(r.id, 'addrLast', last);
      checkOneways(r.id, base);
    }
  }, [routes, patchRoute, geocode, checkOneways]);

  return { checkOneways };
}
