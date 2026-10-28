import { describe, expect, it } from 'vitest';
import { parseKml, type Coord, type Organization } from '@core';
import {
  addrText,
  chosenMainOf,
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
} from '../../../src/editor/state/derived';
import type { ReviewEditor } from '../../../src/editor/state/review';
import type { AddrState, Route } from '../../../src/editor/services/route';
import { kml, path } from '../../helpers';

const mainCoords = path([-99.2, 18.6], [-99.2, 18.62]);
const backCoords = [...mainCoords].reverse();
const shortCoords = path([-99.2, 18.605], [-99.1985, 18.608], [-99.2, 18.611]);

const ok = (full: string): AddrState => ({ state: 'ok', address: { full } });

function route(id: string, letter: string, coords: Coord[], over: Partial<Route> = {}): Route {
  const text = kml(letter, [{ coords, props: { DESCRIPCIO: 'JOJUTLA-PUENTE DE IXTLA' } }]);
  return {
    id,
    letter,
    color: '#000',
    source: { file: new File([text], `${letter}.kml`), path: `${letter}.kml` },
    parsed: parseKml(text),
    reversed: false,
    outName: letter,
    folder: '',
    visible: true,
    ...over,
  };
}

const a = route('a', 'A', mainCoords);
const b = route('b', 'B', backCoords);
const s = route('s', 'C', shortCoords);
const byId = { a, b, s };
const org = organizeRoutes([a, b, s], 50)!;

describe('geometryKey', () => {
  it('es igual mientras no cambie nada y distinta si cambia el sentido, la visibilidad o la geometría', () => {
    const key = geometryKey([a, b]);
    expect(geometryKey([a, b])).toBe(key);
    expect(geometryKey([{ ...a, reversed: true }, b])).not.toBe(key);
    expect(geometryKey([a, { ...b, visible: false }])).not.toBe(key);
    expect(geometryKey([{ ...a, edited: [...a.parsed.coords] }, b])).not.toBe(key);
    // un cambio que no toca la geometría (p. ej. el nombre) no la altera
    expect(geometryKey([{ ...a, outName: 'otro' }, b])).toBe(key);
  });
});

describe('organizeRoutes', () => {
  it('reconoce las dos principales como dupla y el tramo corto', () => {
    expect(org.role.a.kind).toBe('principal');
    expect(org.role.b.kind).toBe('principal');
    expect(org.role.s.kind).toBe('corto');
    expect(org.duplas.map((d) => [...d.ids].sort())).toEqual([['a', 'b']]);
    expect(org.relations.s[0].kind).toBe('variante');
  });

  it('no cuenta las alternas y devuelve null si no queda ningún trazo', () => {
    expect(organizeRoutes([], 50)).toBeNull();
    expect(organizeRoutes([route('x', 'X', mainCoords, { alt: { mainId: 'a', shortId: 's' } })], 50)).toBeNull();
    expect(Object.keys(organizeRoutes([a, route('x', 'X', shortCoords, { alt: { mainId: 'a', shortId: 's' } })], 50)!.role)).toEqual(['a']);
  });
});

describe('comparePairs', () => {
  it('compara las principales visibles de dos en dos', () => {
    const pairs = comparePairs([a, b, s], org, 50);
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([['a', 'b']]);
    expect(pairs[0].result.direction).toBe('opuesto');
  });

  it('ignora las ocultas y las alternas', () => {
    expect(comparePairs([a, { ...b, visible: false }, s], org, 50)).toEqual([]);
  });

  it('con más de 4 principales sólo compara las 4 primeras', () => {
    const many = ['1', '2', '3', '4', '5'].map((id) => route(id, id, mainCoords));
    const fake = { role: Object.fromEntries(many.map((r) => [r.id, { kind: 'principal', percent: 100 }])) } as unknown as Organization;
    expect(comparePairs(many, fake, 50)).toHaveLength(6);
  });
});

describe('routeHints e invertSuggestions', () => {
  it('compara la descripción con las direcciones de los extremos', () => {
    const fine = { ...a, addrFirst: ok('Calle Leyva, Jojutla'), addrLast: ok('Puente de Ixtla, Morelos') };
    const wrong = { ...b, addrFirst: ok('Puente de Ixtla, Morelos'), addrLast: ok('Calle Leyva, Jojutla') };
    const hints = routeHints([fine, wrong, s], org);
    expect(hints.a.hint).toBe('coincide');
    expect(hints.b.hint).toBe('invertido');
    expect(hints.a.ends).toMatchObject({ origin: expect.stringMatching(/jojutla/i) });
  });

  it('un tramo corto no usa la descripción de la ruta completa', () => {
    expect(routeHints([s], org).s).toEqual({ ends: null, hint: 'sin-datos' });
  });

  it('sugiere invertir lo que la descripción marca invertido, con su motivo', () => {
    const wrong = { ...b, addrFirst: ok('Puente de Ixtla, Morelos'), addrLast: ok('Calle Leyva, Jojutla') };
    const out = invertSuggestions([a, wrong], routeHints([a, wrong], org));
    expect(out.map((x) => [x.route.id, x.reasons])).toEqual([['b', ['la descripción']]]);
  });

  it('también por las calles de un sentido, y junta los dos motivos', () => {
    const oneway = (agreeM: number, againstM: number): Route['oneway'] => ({ state: 'ok', base: a.parsed.coords, result: { agreeM, againstM, stretches: [] } });
    const against = { ...a, oneway: oneway(10, 900) };
    expect(invertSuggestions([against], routeHints([against], org))[0].reasons).toEqual(['las calles de un sentido']);
    const wrong = { ...against, addrFirst: ok('Puente de Ixtla'), addrLast: ok('Jojutla') };
    expect(invertSuggestions([wrong], routeHints([wrong], org))[0].reasons).toEqual(['la descripción', 'las calles de un sentido']);
    expect(invertSuggestions([{ ...a, oneway: oneway(900, 10) }], routeHints([a], org))).toEqual([]);
  });

  it('addrText sólo devuelve la dirección cuando ya llegó', () => {
    expect(addrText(ok('x'))?.full).toBe('x');
    expect(addrText({ state: 'loading' })).toBeUndefined();
    expect(addrText(undefined)).toBeUndefined();
  });
});

describe('toMapRoutes', () => {
  it('marca los tramos cortos como menores, usa la opacidad y los tramos en contra', () => {
    const stretch = {
      name: 'Av. X',
      meters: 120,
      agree: false,
      coords: [
        [0, 0],
        [0, 1],
      ] as Coord[],
    };
    const withOneway = {
      ...a,
      opacity: 0.4,
      oneway: {
        state: 'ok',
        base: a.parsed.coords,
        result: { agreeM: 5, againstM: 120, stretches: [stretch, { ...stretch, agree: true }] },
      } as Route['oneway'],
    };
    const [ra, , rs] = toMapRoutes([withOneway, b, s], org);
    expect(ra).toMatchObject({ id: 'a', letter: 'A', opacity: 0.4, minor: false, visible: true });
    expect(ra.against).toEqual([stretch.coords]);
    expect(rs.minor).toBe(true);
    expect(rs.opacity).toBe(1);
  });
});

describe('duplas', () => {
  it('duplaIndex da a cada trazo el número de su dupla y a una alterna el de su principal', () => {
    const alt = route('x', 'X', mainCoords, { alt: { mainId: 'a', shortId: 's' } });
    const index = duplaIndex(org, [a, b, s, alt]);
    expect(index.a).toBe(index.b);
    expect(index.x).toBe(index.a);
    expect(index.s).toBeUndefined();
    expect(duplaIndex(null, [a])).toEqual({});
  });

  it('createdAlternatives lista las alternas como principal:tramo', () => {
    expect(createdAlternatives([a, route('x', 'X', mainCoords, { alt: { mainId: 'a', shortId: 's' } })])).toEqual(new Set(['a:s']));
  });
});

describe('reviewGroupsFor', () => {
  const review = (over: Partial<ReviewEditor> = {}): ReviewEditor => ({
    lote: 'SUR',
    totalTrazos: 3,
    pendientes: [0, 1, 2].map((i) => ({ traza: `t${i}`, indice: i })),
    mapa: 'mapa-1',
    ...over,
  });
  const indexed = [a, b, s].map((r, i) => ({ ...r, parsed: { ...r.parsed, index: i } }));
  const duplaOf = { a: 1, b: 1 };

  it('sin mapa a evaluar a mano no hay grupos', () => {
    expect(reviewGroupsFor(null, indexed, duplaOf, org)).toBeNull();
    expect(reviewGroupsFor(review({ mapa: undefined }), indexed, duplaOf, org)).toBeNull();
  });

  it('cada trazo lleva la dupla del editor; el que no tiene abre una nueva', () => {
    const groups = reviewGroupsFor(review(), indexed, duplaOf, { ...org, folderOf: { s: 'sin-relacion' } })!;
    expect(Object.fromEntries(groups)).toEqual({ a: 1, b: 1, s: 2 });
  });

  it('un tramo corto toma la carpeta numérica de su principal, y sólo cuentan los que siguen en el editor', () => {
    const groups = reviewGroupsFor(
      review({
        pendientes: [
          { traza: 't0', indice: 0 },
          { traza: 't2', indice: 2 },
        ],
      }),
      indexed,
      duplaOf,
      { ...org, folderOf: { s: '1' } },
    )!;
    expect(Object.fromEntries(groups)).toEqual({ a: 1, s: 1 });
  });
});

describe('tramos cortos y sus principales', () => {
  it('chosenMainOf: la elegida o, si no hay, la recomendada', () => {
    const recommended = org.relations.s[0].mainId;
    expect(chosenMainOf(org, {}, 's')).toBe(recommended);
    const other = recommended === 'a' ? 'b' : 'a';
    const options = org.relations.s.map((r) => r.mainId);
    expect(chosenMainOf(org, { s: other }, 's')).toBe(options.includes(other) ? other : recommended);
    expect(chosenMainOf(org, {}, 'a')).toBeUndefined();
    expect(chosenMainOf(null, {}, 's')).toBeUndefined();
  });

  it('relationOf: la relación con la principal, y con los vértices ajustados a mano', () => {
    const mainId = org.relations.s[0].mainId;
    const rel = relationOf(org, byId, {}, 's', mainId)!;
    expect(rel.kind).toBe('variante');
    expect(relationOf(org, byId, {}, 's', 'nadie')).toBeUndefined();
    const moved = relationOf(org, byId, { [`${mainId}:s`]: { out: 2 } }, 's', mainId)!;
    expect(moved.outVertex).toBe(2);
    expect(moved.outVertex).not.toBe(rel.outVertex);
  });

  it('junctionPoints marca la salida y la reincorporación sólo del tramo corto seleccionado', () => {
    const points = junctionPoints('s', org, byId, {}, {});
    expect(points).toHaveLength(2);
    expect(points[0].label).toMatch(/^sale de [AB] · vértice \d+$/);
    expect(points[1].label).toMatch(/^se reincorpora a [AB] · vértice \d+$/);
    expect(junctionPoints('a', org, byId, {}, {})).toEqual([]);
    expect(junctionPoints(null, org, byId, {}, {})).toEqual([]);
  });
});
