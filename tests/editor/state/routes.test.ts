import { describe, expect, it } from 'vitest';
import { organize, parseKml, relate, type Coord, type ParsedKml } from '@core';
import {
  alternativeDraft,
  appendRoute,
  buildRoutes,
  COLORS,
  freeSlot,
  geometryPatch,
  invertPatch,
  letterAt,
  MAX_HISTORY,
  outputNames,
  removedFrom,
  restorePatch,
  restoreRoutes,
  sameCoord,
  sortLongestFirst,
  undoPatch,
  type ParsedEntry,
} from '../../../src/editor/state/routes';
import type { Route } from '../../../src/editor/services/route';
import { kml, path } from '../../helpers';

const parsed = (over: Partial<ParsedKml> = {}): ParsedKml => ({
  text: '',
  index: 0,
  count: 1,
  folderPath: [],
  name: '',
  props: {},
  coords: [
    [0, 0],
    [0, 1],
  ],
  markers: {},
  ...over,
});

const route = (over: Partial<Route> & { id: string }): Route => ({
  letter: 'A',
  color: '#000',
  source: { file: new File([''], 'a.kml'), path: 'a.kml' },
  parsed: parsed(),
  reversed: false,
  outName: 'a',
  folder: '',
  visible: true,
  ...over,
});

const entry = (file: string, over: Partial<ParsedKml> = {}, len = 1, dir = ''): ParsedEntry => ({
  source: { file: new File([''], file), path: dir + file },
  parsed: parsed(over),
  len,
});

describe('letras y huecos', () => {
  it('letterAt: A–Z y después A1, B1…', () => {
    expect([0, 1, 25, 26, 27, 52].map(letterAt)).toEqual(['A', 'B', 'Z', 'A1', 'B1', 'A2']);
  });

  it('freeSlot: la primera letra libre, aunque se hayan eliminado trazos', () => {
    expect(freeSlot([])).toBe(0);
    expect(freeSlot([route({ id: '1', letter: 'A' }), route({ id: '2', letter: 'B' })])).toBe(2);
    // se quitó B: ocupa su lugar, no repite la C
    expect(freeSlot([route({ id: '1', letter: 'A' }), route({ id: '3', letter: 'C' })])).toBe(1);
  });

  it('sameCoord compara por valor y es falso si falta alguna', () => {
    expect(sameCoord([1, 2], [1, 2])).toBe(true);
    expect(sameCoord([1, 2], [1, 3])).toBe(false);
    expect(sameCoord(undefined, [1, 2])).toBe(false);
  });
});

describe('carga: orden y nombres', () => {
  it('sortLongestFirst: del más largo al más corto, y empata por ruta e índice', () => {
    const a = entry('b.kml', { index: 0 }, 5);
    const b = entry('a.kml', { index: 1 }, 5);
    const c = entry('a.kml', { index: 0 }, 5);
    const d = entry('z.kml', { index: 0 }, 9);
    expect(sortLongestFirst([a, b, c, d])).toEqual([d, c, b, a]);
  });

  it('un archivo con un solo trazo se llama como el archivo (sin .kml)', () => {
    expect(outputNames([entry('R1S-JOJU-IXT.kml'), entry('otro.kmz')])).toEqual(['R1S-JOJU-IXT', 'otro']);
  });

  it('con varios trazos se usa el nombre del trazo; sin nombre, el del archivo y el número', () => {
    const names = outputNames([entry('mapa.kml', { count: 2, index: 0, name: 'IDA' }), entry('mapa.kml', { count: 2, index: 1, name: '' })]);
    expect(names).toEqual(['IDA', 'mapa 2']);
  });

  it('si un nombre se repite, se distingue con la DESCRIPCIO o con un número', () => {
    const withDesc = outputNames([
      entry('m.kml', { count: 2, index: 0, name: 'RUTA', props: { DESCRIPCIO: 'JOJUTLA-IXTLA' } }),
      entry('m.kml', { count: 2, index: 1, name: 'RUTA', props: { DESCRIPCIO: 'IXTLA-JOJUTLA' } }),
    ]);
    expect(withDesc).toEqual(['RUTA (JOJUTLA-IXTLA)', 'RUTA (IXTLA-JOJUTLA)']);
    const noDesc = outputNames([entry('m.kml', { count: 2, index: 0, name: 'RUTA' }), entry('m.kml', { count: 2, index: 1, name: 'RUTA' })]);
    expect(noDesc).toEqual(['RUTA', 'RUTA (2)']);
  });

  it('los caracteres que no valen en un archivo se cambian por «-»', () => {
    expect(outputNames([entry('m.kml', { count: 2, name: 'A/B: ruta?' })])).toEqual(['A-B- ruta-']);
  });
});

describe('buildRoutes', () => {
  const list = [
    entry('a.kml', {
      index: 0,
      coords: [
        [0, 0],
        [0, 1],
      ],
      markers: { start: [0, 0], end: [0, 1] },
    }),
    entry('b.kml', {
      index: 3,
      coords: [
        [0, 0],
        [0, 1],
      ],
      markers: { start: [0, 1], end: [0, 0] },
    }),
    entry('c.kml', { count: 2, index: 1, folderPath: ['1', 'ALTERNAS: x'] }),
  ];
  const routes = buildRoutes(list, ['a', 'b', 'c'], [{ indice: 3, nombre: 'R1/X' }]);

  it('asigna letras y colores por posición, con ids distintos', () => {
    expect(routes.map((r) => r.letter)).toEqual(['A', 'B', 'C']);
    expect(routes.map((r) => r.color)).toEqual(COLORS.slice(0, 3));
    expect(new Set(routes.map((r) => r.id)).size).toBe(3);
    expect(routes.every((r) => r.visible)).toBe(true);
  });

  it('marca invertido sólo si los marcadores INICIO/FINAL están al revés', () => {
    expect(routes.map((r) => r.reversed)).toEqual([false, true, false]);
  });

  it('un nombre sugerido por el orquestador gana (saneado) al calculado', () => {
    expect(routes.map((r) => r.outName)).toEqual(['a', 'R1-X', 'c']);
  });

  it('con varios trazos toma la carpeta que traen en el KML', () => {
    expect(routes.map((r) => r.folder)).toEqual(['', '', '1/ALTERNAS- x']);
  });
});

describe('geometría e historial', () => {
  const base: Coord[] = [
    [0, 0],
    [1, 1],
    [2, 2],
  ];
  const edited: Coord[] = [
    [0, 0],
    [2, 2],
  ];

  it('invertPatch alterna el sentido y limpia el aviso de guardado', () => {
    expect(invertPatch(route({ id: '1', reversed: false, saved: 'Guardado' }))).toEqual({ reversed: true, saved: undefined });
    expect(invertPatch(route({ id: '1', reversed: true }))).toEqual({ reversed: false, saved: undefined });
  });

  it('geometryPatch guarda la anterior y escribe en el orden del archivo', () => {
    const r = route({ id: '1', parsed: parsed({ coords: base }) });
    expect(geometryPatch(r, edited)).toEqual({ edited, history: [base], saved: undefined });
    // un trazo invertido recibe la geometría en el sentido de exportación: se guarda al revés
    const rev = route({ id: '1', reversed: true, parsed: parsed({ coords: base }) });
    expect(geometryPatch(rev, edited).edited).toEqual([
      [2, 2],
      [0, 0],
    ]);
  });

  it('el historial no pasa de MAX_HISTORY', () => {
    const history = Array.from({ length: MAX_HISTORY }, (_, i): Coord[] => [[i, i]]);
    const patch = geometryPatch(route({ id: '1', history, parsed: parsed({ coords: base }) }), edited);
    expect(patch.history).toHaveLength(MAX_HISTORY);
    expect(patch.history![MAX_HISTORY - 1]).toBe(base);
    expect(patch.history![0]).toBe(history[1]);
  });

  it('undoPatch vuelve a la anterior; si era la del archivo, quita la edición', () => {
    const original = parsed({ coords: base });
    const twice = route({
      id: '1',
      parsed: original,
      edited,
      history: [
        base,
        [
          [0, 0],
          [1, 1],
        ],
      ],
    });
    expect(undoPatch(twice)).toEqual({
      edited: [
        [0, 0],
        [1, 1],
      ],
      history: [base],
      saved: undefined,
    });
    const once = route({ id: '1', parsed: original, edited, history: [original.coords] });
    expect(undoPatch(once)).toEqual({ edited: undefined, history: [], saved: undefined });
  });

  it('undoPatch sin historial no cambia nada', () => {
    expect(undoPatch(route({ id: '1' }))).toEqual({});
  });

  it('restorePatch vuelve al archivo y deja la geometría actual en el historial', () => {
    const r = route({ id: '1', parsed: parsed({ coords: base }), edited, history: [] });
    expect(restorePatch(r)).toEqual({ edited: undefined, history: [edited], saved: undefined });
  });
});

describe('quitar y devolver trazos', () => {
  const rs = ['1', '2', '3', '4'].map((id) => route({ id, derivedFor: [[0, 0]] }));

  it('removedFrom recuerda la posición de cada trazo', () => {
    expect(removedFrom(rs, ['2', '4']).map((x) => [x.route.id, x.index])).toEqual([
      ['2', 1],
      ['4', 3],
    ]);
  });

  it('restoreRoutes los devuelve a su posición y reinicia derivedFor', () => {
    const removed = removedFrom(rs, ['2', '4']);
    const left = rs.filter((r) => !['2', '4'].includes(r.id));
    const back = restoreRoutes(left, removed, ['2', '4']);
    expect(back.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
    expect(back[1].derivedFor).toBeUndefined();
    expect(back[0].derivedFor).toBeDefined();
  });

  it('si la lista quedó más corta, los pone al final; si ya volvieron, no repite', () => {
    const removed = removedFrom(rs, ['3', '4']);
    expect(restoreRoutes([rs[0]], removed, ['3', '4']).map((r) => r.id)).toEqual(['1', '3', '4']);
    expect(restoreRoutes(rs, removed, ['3', '4'])).toBe(rs);
  });
});

describe('ruta alterna', () => {
  const mainCoords = path([-99.2, 18.6], [-99.2, 18.62]);
  const shortCoords = path([-99.2, 18.605], [-99.195, 18.61], [-99.2, 18.615]);
  const mainText = kml('MAIN', [{ coords: mainCoords }]);
  const main = route({
    id: 'm',
    letter: 'A',
    outName: 'MAIN',
    parsed: parseKml(mainText),
    source: { file: new File([mainText], 'main.kml'), path: 'SUR/R1/1/main.kml' },
  });
  const short = route({ id: 's', letter: 'B', outName: 'AMPL. LIBRAMIENTO', parsed: parseKml(kml('S', [{ coords: shortCoords }])) });
  const rel = organize(
    [
      { id: 'm', coords: main.parsed.coords, lengthM: 2200 },
      { id: 's', coords: short.parsed.coords, lengthM: 900 },
    ],
    50,
  ).relations.s[0];

  it('arma la ruta con la principal, el tramo y la principal', () => {
    expect(relate(short.parsed.coords, main.parsed.coords).kind).toBe('variante');
    const alt = alternativeDraft(main, short, rel);
    expect(alt.alt).toEqual({ mainId: 'm', shortId: 's' });
    expect(alt.outName).toBe('MAIN ALT LIBRAMIENTO');
    expect(alt.source.path).toBe('SUR/R1/1/MAIN ALT LIBRAMIENTO.kml');
    expect(alt.source.isNew).toBe(true);
    expect(alt.reversed).toBe(false);
    // sale de la principal, rodea y vuelve: llega hasta el desvío (la principal está en -99.2)
    expect(Math.max(...alt.parsed.coords.map((c) => c[0]))).toBeGreaterThan(-99.196);
    expect(alt.parsed.coords[0]).toEqual(main.parsed.coords[0]);
  });

  it('appendRoute la agrega al final con la primera letra y color libres de la lista actual', () => {
    const draft = alternativeDraft(main, short, rel);
    const out = appendRoute([main, short], draft, 'x1');
    expect(out).toHaveLength(3);
    expect([out[2].id, out[2].letter, out[2].color]).toEqual(['x1', 'C', COLORS[2]]);
    // si se había quitado la B, ocupa su lugar
    expect(appendRoute([main], draft, 'x2')[1].letter).toBe('B');
  });

  it('lanza si el tramo no se puede unir (el editor lo atrapa y avisa)', () => {
    const none = { ...rel, kind: 'ninguna' as const };
    expect(() => alternativeDraft(main, short, none)).toThrow();
  });
});
