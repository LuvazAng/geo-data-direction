import { describe, expect, it } from 'vitest';
import { ColoniaIndex, endpointColonias, type ColoniaFeature, type Coord } from '@core';

const square = (id: number, nombre: string, west: number, east: number): ColoniaFeature => ({
  type: 'Feature',
  properties: { id, nombre, tipo: 'Colonia', municipio: 'Cuautla', cp: '62740' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [west, 18.8],
        [east, 18.8],
        [east, 18.81],
        [west, 18.81],
        [west, 18.8],
      ],
    ],
  },
});

// A y B están separadas por un hueco de ~50 m (0.0005° de longitud a esta latitud)
const index = new ColoniaIndex({
  type: 'FeatureCollection',
  fuente: 'prueba',
  features: [square(1, 'Tierra Larga', -98.95, -98.94), square(2, '12 de Octubre', -98.9395, -98.93)],
});

const line = (...lngs: number[]): Coord[] => lngs.map((x) => [x, 18.805]);

describe('endpointColonias', () => {
  it('la colonia de inicio y la de final son las que contienen los extremos', () => {
    const r = endpointColonias(line(-98.945, -98.94, -98.935, -98.932), index);
    expect(r.inicio?.nombre).toBe('Tierra Larga');
    expect(r.final?.nombre).toBe('12 de Octubre');
  });

  it('al invertir el trazo se invierten también inicio y final', () => {
    const r = endpointColonias(line(-98.932, -98.935, -98.94, -98.945), index);
    expect(r.inicio?.nombre).toBe('12 de Octubre');
    expect(r.final?.nombre).toBe('Tierra Larga');
  });

  it('si un extremo cae fuera de toda colonia, toma la que más recorre en sus primeros metros', () => {
    // empieza en el hueco entre las dos colonias y avanza hacia la segunda
    const r = endpointColonias(line(-98.93975, -98.935, -98.932), index);
    expect(r.inicio?.nombre).toBe('12 de Octubre');
    expect(r.final?.nombre).toBe('12 de Octubre');
  });

  it('un trazo que no toca ninguna colonia no tiene ni inicio ni final', () => {
    const far = endpointColonias(
      [
        [-99.5, 19.2],
        [-99.49, 19.2],
      ],
      index,
    );
    expect(far).toEqual({ inicio: null, final: null });
  });

  it('un trazo sin dos puntos no se puede ubicar', () => {
    expect(endpointColonias([[-98.945, 18.805]], index)).toEqual({ inicio: null, final: null });
    expect(endpointColonias([], index)).toEqual({ inicio: null, final: null });
  });
});
