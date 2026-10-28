import { describe, expect, it } from 'vitest';
import { ColoniaIndex, type ColoniaFeature, type Coord } from '@core';
import type { Route } from '../../../src/editor/services/route';
import { nameGroup, placesToAbbreviate, reportsFor, subjectOf } from '../../../src/editor/state/naming';

const MESSY = '5.-(3.-CIRCUNVALACION (COL. PABLO TORRES BURGOS)-TIERRA LARGA Y 12 DE OCTUBRE (BASE TACAMBRO-CIRCUNVALACIàN)';

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
const index = new ColoniaIndex({
  type: 'FeatureCollection',
  fuente: 'prueba',
  features: [square(1, 'Tierra Larga', -98.95, -98.94), square(2, '12 de Octubre', -98.9395, -98.93)],
});

const ida: Coord[] = [-98.945, -98.94, -98.935, -98.932].map((x) => [x, 18.805]);
const regreso = [...ida].reverse();

/** Un trazo de prueba con sólo lo que lee el nombre. */
const route = (id: string, letter: string, coords: Coord[], over: Partial<Route> = {}): Route =>
  ({
    id,
    letter,
    color: '#3b82f6',
    parsed: { name: MESSY, coords, props: {}, markers: [], index: 0, count: 2, folderPath: [], text: '' },
    source: { file: { name: 'mapa.kml' } },
    outName: MESSY,
    reversed: false,
    ...over,
  }) as unknown as Route;

const A = route('a', 'A', ida);
const B = route('b', 'B', regreso, { parsed: { ...A.parsed, coords: regreso, name: 'REGRESO LIBRE' } as Route['parsed'], outName: 'REGRESO LIBRE' });
const siglas = (lugar: string) => ({ 'Tierra Larga': 'TLARG', '12 de Octubre': '12OCT' })[lugar] ?? '';

describe('subjectOf', () => {
  it('toma las colonias de inicio y final en el sentido en que va el trazo, y su nombre original', () => {
    const s = subjectOf(A, index);
    expect(s).toMatchObject({ id: 'a', letter: 'A', original: MESSY, actual: MESSY });
    expect(s.inicio).toMatchObject({ nombre: 'Tierra Larga', tipo: 'Colonia', municipio: 'Cuautla' });
    expect(s.final?.nombre).toBe('12 de Octubre');
  });

  it('al invertir el trazo se invierten inicio y final', () => {
    const s = subjectOf({ ...A, reversed: true }, index);
    expect(s.inicio?.nombre).toBe('12 de Octubre');
    expect(s.final?.nombre).toBe('Tierra Larga');
  });

  it('si el nombre del KML está vacío usa el del archivo', () => {
    const s = subjectOf({ ...A, parsed: { ...A.parsed, name: '' }, source: { file: { name: 'RUTA 6.kml' } } } as Route, index);
    expect(s.original).toBe('RUTA 6');
  });
});

describe('nameGroup y placesToAbbreviate', () => {
  it('agrupa el trazo con los de su dupla, sin alternas', () => {
    const alt = route('c', 'C', ida, { alt: { mainId: 'a', shortId: 'x' } } as Partial<Route>);
    const routes = [A, B, alt];
    expect(nameGroup('a', routes, { a: 1, b: 1, c: 1 })).toEqual(['a', 'b']);
    expect(nameGroup('a', routes, {})).toEqual(['a']);
    expect(nameGroup('b', routes, { a: 1, b: 2 })).toEqual(['b']);
  });

  it('pide cada colonia una sola vez aunque la compartan la ida y el regreso', () => {
    const places = placesToAbbreviate([subjectOf(A, index), subjectOf(B, index)]);
    expect(places.map((p) => p.nombre)).toEqual(['Tierra Larga', '12 de Octubre']);
    expect(places[0]).toEqual({ nombre: 'Tierra Larga', tipo: 'Colonia', municipio: 'Cuautla' });
  });
});

describe('reportsFor', () => {
  const subjects = [subjectOf(A, index), subjectOf(B, index)];
  const names = { a: A.outName, b: B.outName };

  it('el regreso es el nombre de la ida al revés, con las mismas siglas', () => {
    const r = reportsFor(subjects, names, 'R6O', siglas);
    expect(r.get('a')?.propuesta).toBe('R6O-TLARG-12OCT');
    expect(r.get('b')?.propuesta).toBe('R6O-12OCT-TLARG');
  });

  it('compara el original con la propuesta con tu ejemplo: 2 de 6 contra 6 de 6', () => {
    const rep = reportsFor(subjects, names, 'R6O', siglas).get('a')!;
    expect(rep.candidatos.map((c) => `${c.clave}:${c.evaluacion.cumple}`)).toEqual(['original:2', 'propuesta:6']);
    expect(rep.comparacion).toMatchObject({ mejor: 'propuesta', texto: 'La propuesta se acerca más al nombre ideal (6 de 6 contra 2 de 6).' });
  });

  it('si el nombre actual ya es otro (p. ej. una sugerencia del orquestador), también se evalúa', () => {
    const withActual = [{ ...subjects[0], actual: 'R6BO-CIRC-TETE' }, subjects[1]];
    const rep = reportsFor(withActual, names, 'R6O', siglas).get('a')!;
    expect(rep.candidatos.map((c) => c.clave)).toEqual(['original', 'actual', 'propuesta']);
    expect(rep.candidatos[1].evaluacion.criterios.find((c) => c.id === 'lugares')?.detalle).toMatch(/Dice CIRC-TETE/);
  });

  it('una vez aplicada la propuesta, el nombre actual no sale repetido', () => {
    const applied = [{ ...subjects[0], actual: 'R6O-TLARG-12OCT' }, subjects[1]];
    const rep = reportsFor(applied, { a: 'R6O-TLARG-12OCT', b: B.outName }, 'R6O', siglas).get('a')!;
    expect(rep.candidatos.map((c) => c.clave)).toEqual(['original', 'propuesta']);
  });

  it('si el original ya es la propuesta no hay nada que comparar', () => {
    const named = [{ ...subjects[0], original: 'R6O-TLARG-12OCT', actual: 'R6O-TLARG-12OCT' }, subjects[1]];
    const rep = reportsFor(named, { a: 'R6O-TLARG-12OCT', b: B.outName }, 'R6O', siglas).get('a')!;
    expect(rep.propuesta).toBe('R6O-TLARG-12OCT');
    expect(rep.candidatos.map((c) => `${c.clave}:${c.evaluacion.cumple}`)).toEqual(['original:6']);
    expect(rep.comparacion).toBeNull();
  });

  it('sin siglas válidas de una colonia no hay propuesta, pero el original se sigue evaluando', () => {
    const rep = reportsFor(subjects, names, 'R6O', (lugar) => (lugar === 'Tierra Larga' ? 'TLARG' : '')).get('a')!;
    expect(rep.propuesta).toBeNull();
    expect(rep.comparacion).toBeNull();
    expect(rep.candidatos.map((c) => c.clave)).toEqual(['original']);
  });

  it('siglas escritas a mano que no son válidas (muy largas) no generan propuesta', () => {
    expect(reportsFor(subjects, names, 'R6O', (l) => (l === 'Tierra Larga' ? 'TIERRALARGA' : '12OCT')).get('a')?.propuesta).toBeNull();
  });

  it('un trazo cuyo extremo no cae en ninguna colonia no tiene informe', () => {
    const lost = subjectOf(
      route('z', 'Z', [
        [-99.5, 19.2],
        [-99.49, 19.2],
      ]),
      index,
    );
    expect(reportsFor([lost], { z: 'x' }, 'R6O', siglas).get('z')).toBeNull();
  });

  it('si la propuesta ya la lleva otro trazo del editor, no es única', () => {
    const rep = reportsFor(subjects, { ...names, otro: 'R6O-TLARG-12OCT' }, 'R6O', siglas).get('a')!;
    const propuesta = rep.candidatos.find((c) => c.clave === 'propuesta')!;
    expect(propuesta.evaluacion.criterios.find((c) => c.id === 'unico')?.ok).toBe(false);
  });

  it('dos trazos de la dupla que proponen el mismo nombre se avisan entre sí', () => {
    // ida y regreso que empiezan y terminan en la misma colonia
    const loopA = route('a', 'A', [
      [-98.945, 18.805],
      [-98.944, 18.805],
      [-98.945, 18.8051],
    ]);
    const loopB = route('b', 'B', [
      [-98.9445, 18.805],
      [-98.9441, 18.805],
      [-98.9446, 18.8051],
    ]);
    const both = [subjectOf(loopA, index), subjectOf(loopB, index)];
    const r = reportsFor(both, { a: loopA.outName, b: loopB.outName }, 'R6O', siglas);
    expect(r.get('a')?.propuesta).toBe('R6O-TLARG-TLARG');
    expect(
      r
        .get('a')
        ?.candidatos.find((c) => c.clave === 'propuesta')
        ?.evaluacion.criterios.find((c) => c.id === 'unico')?.ok,
    ).toBe(false);
  });
});
