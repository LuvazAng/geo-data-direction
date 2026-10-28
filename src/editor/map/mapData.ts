import type { ColoniaFeature, ColoniasRuta, Coord } from '@core';
import type { MapRoute } from '../state/derived';

// Los datos GeoJSON que se pintan en el mapa, a partir del estado del editor.

export type FC = GeoJSON.FeatureCollection;
export const EMPTY: FC = { type: 'FeatureCollection', features: [] };

/** Polígonos de las colonias que cruza el trazo, en orden (alternan intensidad para distinguir vecinas). */
export function coloniasRutaData(ruta: ColoniasRuta | null, byId: Map<number, ColoniaFeature>, color: string): FC {
  return {
    type: 'FeatureCollection',
    features: (ruta?.pasos ?? []).flatMap((p, orden) =>
      p.ids.flatMap((id) => {
        const f = byId.get(id);
        return f ? [{ type: 'Feature' as const, properties: { nombre: p.colonia.nombre, orden, color }, geometry: f.geometry }] : [];
      }),
    ),
  };
}

export function routesData(routes: MapRoute[], selectedId: string | null, override?: { id: string; coords: Coord[] }): FC {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((r) => r.visible)
      .map((r) => ({
        type: 'Feature',
        properties: {
          id: r.id,
          color: r.color,
          opacity: r.opacity,
          minor: !!r.minor,
          selected: r.id === selectedId,
          dim: !!selectedId && r.id !== selectedId,
        },
        geometry: { type: 'LineString', coordinates: override?.id === r.id ? override.coords : r.coords },
      })),
  };
}

export function editData(coords: Coord[] | null): { vertices: FC; mids: FC } {
  if (!coords) return { vertices: EMPTY, mids: EMPTY };
  const point = (c: Coord, i: number) => ({
    type: 'Feature' as const,
    properties: { i },
    geometry: { type: 'Point' as const, coordinates: c },
  });
  return {
    vertices: { type: 'FeatureCollection', features: coords.map(point) },
    mids: {
      type: 'FeatureCollection',
      features: coords.slice(1).map((c, i) => point([(coords[i][0] + c[0]) / 2, (coords[i][1] + c[1]) / 2], i)),
    },
  };
}

export const lines = (list: Coord[][]): FC => ({
  type: 'FeatureCollection',
  features: list.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
});
