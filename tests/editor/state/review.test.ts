import { describe, expect, it } from 'vitest';
import type { ParsedKml } from '@core';
import {
  duplasWithLetters,
  evaluateMapRequest,
  nothingLeftMessage,
  resolveReviewsRequest,
  reviewDoneMessage,
  splitPending,
  type ReviewEditor,
} from '../../../src/editor/state/review';
import type { Route } from '../../../src/editor/services/route';

const route = (id: string, letter: string, index: number, over: Partial<Route> = {}): Route =>
  ({ id, letter, outName: `nombre-${letter}`, parsed: { index } as ParsedKml, ...over }) as Route;

const a = route('a', 'A', 0);
const b = route('b', 'B', 2);
const alt = route('x', 'X', 1, { alt: { mainId: 'a', shortId: 'b' } });

const review: ReviewEditor = {
  lote: 'SUR',
  totalTrazos: 4,
  pendientes: [0, 1, 2, 3].map((indice) => ({ traza: `t${indice}`, indice })),
};
const withMap = { ...review, mapa: 'mapa-7' };
const contentFor = (r: Route) => `<kml ${r.id}/>`;

describe('splitPending', () => {
  it('separa los pendientes que siguen en el editor de los que se eliminaron', () => {
    const split = splitPending(review, [a, b]);
    expect(split.kept.map((t) => t.traza)).toEqual(['t0', 't2']);
    expect(split.removed.map((t) => t.traza)).toEqual(['t1', 't3']);
    expect(split.routesByIndex.get(2)).toBe(b);
  });

  it('una alterna creada en el editor no cuenta como trazo del original', () => {
    const split = splitPending(review, [a, alt]);
    expect(split.kept.map((t) => t.traza)).toEqual(['t0']);
    expect(split.routesByIndex.has(1)).toBe(false);
  });
});

describe('duplasWithLetters', () => {
  it('junta las letras de cada dupla', () => {
    const groups = new Map([
      ['a', 1],
      ['b', 1],
      ['c', 2],
    ]);
    const out = duplasWithLetters(groups, { a, b, c: route('c', 'C', 4) });
    expect([...out]).toEqual([
      [1, ['A', 'B']],
      [2, ['C']],
    ]);
  });

  it('un trazo desconocido se muestra como «?» y sin grupos no hay duplas', () => {
    expect(duplasWithLetters(new Map([['zz', 3]]), {}).get(3)).toEqual(['?']);
    expect(duplasWithLetters(null, {}).size).toBe(0);
  });
});

describe('peticiones al servidor', () => {
  const split = splitPending(withMap, [a, b]);

  it('evaluateMapRequest manda lo que queda, con su dupla, y descarta lo eliminado', () => {
    const groups = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    expect(evaluateMapRequest(withMap, split, groups, contentFor)).toEqual({
      lote: 'SUR',
      mapa: 'mapa-7',
      generar: [
        { traza: 't0', nombre: 'nombre-A', contenidoKml: '<kml a/>', dupla: 1, nota: 'Mapa evaluado a mano; trazo 1' },
        { traza: 't2', nombre: 'nombre-B', contenidoKml: '<kml b/>', dupla: 2, nota: 'Mapa evaluado a mano; trazo 3' },
      ],
      descartar: [
        { traza: 't1', nota: 'Eliminado en el editor al evaluar el mapa; trazo 2' },
        { traza: 't3', nota: 'Eliminado en el editor al evaluar el mapa; trazo 4' },
      ],
    });
  });

  it('resolveReviewsRequest manda un KML por trazo que queda y descarta lo eliminado', () => {
    const out = resolveReviewsRequest(review, splitPending(review, [a, b]), contentFor);
    expect(out.lote).toBe('SUR');
    expect(out.items).toEqual([
      { traza: 't0', nombre: 'nombre-A', contenidoKml: '<kml a/>', nota: 'Geometría editada en el mapa; trazo 1' },
      { traza: 't2', nombre: 'nombre-B', contenidoKml: '<kml b/>', nota: 'Geometría editada en el mapa; trazo 3' },
      { accion: 'descartar', traza: 't1', nota: 'Eliminado en el editor al resolver el mapa; trazo 2' },
      { accion: 'descartar', traza: 't3', nota: 'Eliminado en el editor al resolver el mapa; trazo 4' },
    ]);
  });
});

describe('avisos', () => {
  it('nothingLeftMessage distingue un mapa evaluado a mano de unos conflictos', () => {
    expect(nothingLeftMessage(withMap)).toContain('descártalo desde el centro de control');
    expect(nothingLeftMessage(review)).toContain('para descartarlos usa el centro de control');
  });

  it('reviewDoneMessage cuenta los KML, las duplas y lo descartado', () => {
    expect(reviewDoneMessage(withMap, 2, 0, 2)).toBe('Mapa evaluado: 2 KML en 2 dupla(s)');
    expect(reviewDoneMessage(review, 2, 2, 0)).toBe('Conflictos resueltos: 2 KML individuales generados; 2 trazo(s) eliminado(s) quedaron descartados');
  });
});
