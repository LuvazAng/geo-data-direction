import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Coord } from '@core';
import { classifyPage, type PageInput, type TraceDecision } from '../../../src/orchestrator/domain/classify';
import { loadInegi } from '../../../src/orchestrator/io/inegi';
import { loadLabeled } from '../../../src/orchestrator/domain/labeled';
import { pairMetrics, type Line } from '../../../src/orchestrator/domain/similarity';
import type { MapRef } from '../../../src/orchestrator/io/source';
import { analyzeKml } from '../../../src/orchestrator/domain/traces';
import { FIXTURES, INEGI_DIR, itin, JOJUTLA, kml, line, path, PUENTE_IXTLA, shift, testConfig, tmp } from '../../helpers';

const cfg = testConfig(tmp());
const sim = (a: Line, b: Line) => pairMetrics(a, b, cfg.similitud);

function page(slug: string, maps: { title: string; kml: string; id?: string }[]): PageInput {
  return {
    slug,
    title: slug.toUpperCase(),
    maps: maps.map((m, i) => {
      const id = m.id ?? `mapa${i + 1}xxxxxxx`;
      const ref: MapRef = {
        id,
        kind: 'mymaps',
        title: m.title,
        order: i + 1,
        page: `https://sites.google.com/view/p/sur/${slug}`,
        pageSlug: slug,
        pageTitle: slug.toUpperCase(),
        downloadUrl: '',
      };
      return { ref, data: analyzeKml(id, m.kml) };
    }),
  };
}

const principals = (ds: TraceDecision[]) => ds.filter((d) => d.role === 'principal');

describe('tipo de trazo', () => {
  const kinds = (...descripciones: string[]) =>
    analyzeKml(
      'm',
      kml(
        'X',
        descripciones.map((d) => itin(d, line(JOJUTLA, PUENTE_IXTLA, 2000))),
      ),
    ).traces.map((t) => t.kind);

  it('«Base-Inicio de Recorrido» es un trazo de base', () => {
    expect(kinds('Base-Inicio de Recorrido', 'BASE')).toEqual(['base', 'base']);
  });

  it('una terminal llamada «BASE …» es un lugar, no un trazo de base (Ruta 6 Oriente)', () => {
    expect(kinds('BASE FRESNAL-ATRIOS-BASE COL. CUAHTEMOC', 'WALMART-12 OCT-BASE FRESNAL', 'CIRCUNVALACIÓN-BASE TACAMBRO')).toEqual([
      'itinerario',
      'itinerario',
      'itinerario',
    ]);
  });
});

describe('clasificación y sentido', () => {
  const places = loadInegi(INEGI_DIR);
  const MID: Coord = [-99.25, 18.64];
  const ida = path(JOJUTLA, MID, PUENTE_IXTLA);
  const regreso = shift([...ida].reverse(), 10);

  it('ida y regreso con DESCRIPCIO y extremos en sus localidades: sentido confirmado', () => {
    const r = classifyPage(
      page('ruta-1-sur', [
        {
          title: '1.-JOJUTLA-PUENTE DE IXTLA',
          kml: kml('1. JOJUTLA-PUENTE DE IXTLA-JOJUTLA', [itin('JOJUTLA-PUENTE DE IXTLA', ida), itin('PUENTE DE IXTLA-JOJUTLA', regreso)]),
        },
      ]),
      cfg,
      places,
      sim,
    );
    const [a, b] = principals(r.decisions);
    expect([a.origen, a.destino, a.sentido]).toEqual(['JOJUTLA', 'PUENTE DE IXTLA', 'confirmado']);
    expect([b.origen, b.destino, b.sentido]).toEqual(['PUENTE DE IXTLA', 'JOJUTLA', 'confirmado']);
    expect(r.duplas).toHaveLength(1);
    expect(a.evidencias.some((e) => e.fuente === 'localidad' && e.peso > 0)).toBe(true);
  });

  it('el primer punto no es el origen: si el trazo va al revés de su DESCRIPCIO se manda a revisión y no se invierte', () => {
    const r = classifyPage(
      page('ruta-1-sur', [{ title: '1.-JOJUTLA-PUENTE DE IXTLA', kml: kml('X', [itin('JOJUTLA-PUENTE DE IXTLA', [...ida].reverse())]) }]),
      cfg,
      places,
      sim,
    );
    const [d] = principals(r.decisions);
    expect(d.sentido).toBe('contrario');
    expect(d.revision.join()).toMatch(/al revés/);
    expect(d.inicio.coord).toEqual(PUENTE_IXTLA); // la geometría no se tocó
  });

  it('caso crítico: ida y regreso con la misma geometría y el mismo orden (caso 9)', () => {
    const r = classifyPage(
      page('ruta-1-sur', [
        { title: '1.-JOJUTLA-PUENTE DE IXTLA', kml: kml('X', [itin('JOJUTLA-PUENTE DE IXTLA', ida), itin('PUENTE DE IXTLA-JOJUTLA', [...ida])]) },
      ]),
      cfg,
      places,
      sim,
    );
    const ds = principals(r.decisions);
    expect(ds.every((d) => d.revision.some((m) => /misma geometría en el mismo orden/.test(m)))).toBe(true);
  });

  it('caso crítico: sin metadatos suficientes no se inventa el sentido (caso 9)', () => {
    // ambos extremos dentro de la misma localidad y sin nombres que distingan
    const a: Coord = [-99.1785, 18.6155];
    const b: Coord = [-99.1745, 18.6125];
    const r = classifyPage(
      page('ruta-x-sur', [
        {
          title: '1. CIRCUITO CENTRO',
          kml: kml('X', [
            { coords: line(a, b), props: { 'AUTO-AMPL': 'ITINERARIO' } },
            { coords: line(b, a), props: { 'AUTO-AMPL': 'ITINERARIO' } },
          ]),
        },
      ]),
      cfg,
      places,
      sim,
    );
    for (const d of principals(r.decisions)) {
      expect(d.sentido).toBe('sin-evidencia');
      expect(d.origen).toBeNull();
      expect(d.revision.length).toBeGreaterThan(0);
    }
  });

  it('localidades que no se pueden identificar (caso 10)', () => {
    const lejos = shift(ida, -40_000); // al sur de Morelos, sin localidades a 2 km
    const r = classifyPage(
      page('ruta-1-sur', [{ title: '1.-JOJUTLA-PUENTE DE IXTLA', kml: kml('X', [itin('JOJUTLA-PUENTE DE IXTLA', lejos)]) }]),
      cfg,
      places,
      sim,
    );
    const [d] = principals(r.decisions);
    expect(d.sentido).toBe('sin-evidencia');
    expect(d.revision.join()).toMatch(/ningún extremo coincide|fuera de Morelos/);
  });

  it('dos duplas en el mismo KMZ se separan por su vía (X LA GAS / X LA FARMACIA)', () => {
    const farm = path(JOJUTLA, [-99.25, 18.66], PUENTE_IXTLA);
    const gas = path(JOJUTLA, [-99.25, 18.62], PUENTE_IXTLA);
    const r = classifyPage(
      page('ruta-2-sur', [
        {
          title: '3. JOJUTLA-PUENTE DE IXTLA-JOJUTLA',
          kml: kml('3. JOJUTLA-PUENTE DE IXTLA-JOJUTLA', [
            itin('JOJUTLA-PUENTE DE IXTLA (X LA FARMACIA)', farm),
            itin('JOJUTLA-PUENTE DE IXTLA (X LA GAS)', gas),
            itin('PUENTE DE IXTLA-JOJUTLA (X FARMACIA)', shift([...farm].reverse(), 8)),
            itin('PUENTE DE IXTLA-JOJUTLA (X LAS GAS)', shift([...gas].reverse(), 8)),
          ]),
        },
      ]),
      cfg,
      places,
      sim,
    );
    expect(r.duplas.map((d) => [d.n, d.variante, d.traces.map((t) => t.split('#')[1]).join('+')])).toEqual([
      [1, 'FARMACIA', '0+2'],
      [2, 'GAS', '1+3'],
    ]);
  });

  it('las extensiones consecutivas de RUTA-2-ORIENTE comparten la carpeta del recorrido', () => {
    const extension = [-99.25, 18.64] as Coord;
    const r = classifyPage(
      page('ruta-2-oriente', [
        {
          title: '1.-RASTRO-BENITO QUEZADA-PATOS',
          kml: kml('1.-RASTRO-BENITO QUEZADA-PATOS', [
            itin('BENITO JUAREZ-RASTRO', path(JOJUTLA, extension)),
            itin('RASTRO-BENITO QUEZADA-PATOS', path(extension, PUENTE_IXTLA)),
          ]),
        },
      ]),
      cfg,
      places,
      sim,
    );

    expect(r.duplas).toHaveLength(1);
    expect(r.duplas[0].traces).toHaveLength(2);
    expect(r.decisions.filter((d) => d.role === 'principal').map((d) => d.dupla)).toEqual([r.duplas[0].id, r.duplas[0].id]);
  });

  it('no agrupa como extensión una bifurcación conectada al mismo extremo', () => {
    const extension = [-99.25, 18.64] as Coord;
    const r = classifyPage(
      page('ruta-2-sur', [
        {
          title: '1. JOJUTLA-PUENTE DE IXTLA',
          kml: kml('1. JOJUTLA-PUENTE DE IXTLA', [
            itin('JOJUTLA-TEHUIXTLA', path(JOJUTLA, extension)),
            itin('TEHUIXTLA-PUENTE DE IXTLA', path(extension, PUENTE_IXTLA)),
            itin('TEHUIXTLA-ZACATEPEC', path(extension, [-99.2, 18.7])),
          ]),
        },
      ]),
      cfg,
      places,
      sim,
    );

    expect(r.duplas).toHaveLength(3);
    expect(r.duplas.map((dupla) => dupla.traces)).toEqual([['mapa1xxxxxxx#0'], ['mapa1xxxxxxx#1'], ['mapa1xxxxxxx#2']]);
  });

  it('un trazo publicado en el mapa equivocado se asigna al mapa que lo nombra', () => {
    const r = classifyPage(
      page('ruta-5-sur', [
        {
          title: '1. JOJUTLA-PUENTE DE IXTLA-JOJUTLA',
          kml: kml('A', [
            itin('JOJUTLA-PUENTE DE IXTLA', ida),
            itin('PUENTE DE IXTLA-JOJUTLA', regreso),
            itin('JOJUTLA-TEHUIXTLA', path(JOJUTLA, [-99.27, 18.56])),
          ]),
        },
        { title: '2. JOJUTLA-TEHUIXTLA-JOJUTLA', kml: kml('B', [itin('TEHUIXTLA-JOJUTLA', path([-99.27, 18.56], JOJUTLA))]) },
      ]),
      cfg,
      places,
      sim,
    );
    const moved = r.decisions.find((d) => d.origen === 'JOJUTLA' && d.destino === 'TEHUIXTLA')!;
    expect(moved.assignedMapId).toBe('mapa2xxxxxxx');
    expect(r.duplas.find((d) => d.mapId === 'mapa2xxxxxxx')!.traces).toHaveLength(2);
  });

  it('ampliaciones y tramos cortos no son principales y se relacionan con su principal', () => {
    const r = classifyPage(
      page('ruta-1-sur', [
        {
          title: '1.-JOJUTLA-PUENTE DE IXTLA',
          kml: kml('X', [
            itin('JOJUTLA-PUENTE DE IXTLA', ida),
            { name: 'AMPL. CENTRO', coords: line(MID, [-99.25, 18.63]), props: { 'AUTO-AMPL': 'AMPLIACION' } },
          ]),
        },
      ]),
      cfg,
      places,
      sim,
    );
    const ampl = r.decisions.find((d) => d.role === 'ampliacion')!;
    expect(ampl.relacion?.principal).toBe(principals(r.decisions)[0].traceId);
  });

  it('clasificación reproducible', () => {
    const input = () =>
      page('ruta-1-sur', [
        { title: '1.-JOJUTLA-PUENTE DE IXTLA', kml: kml('X', [itin('JOJUTLA-PUENTE DE IXTLA', ida), itin('PUENTE DE IXTLA-JOJUTLA', regreso)]) },
      ]);
    expect(JSON.stringify(classifyPage(input(), cfg, places, sim))).toBe(JSON.stringify(classifyPage(input(), cfg, places, sim)));
  });

  describe('casos etiquetados reales (GEODATA/RUTAS/SUR)', () => {
    const labeled = loadLabeled(join(FIXTURES, 'etiquetados')).files;
    const check = (fixture: string, title: string, slug: string) => {
      const r = classifyPage(page(slug, [{ title, kml: readFileSync(join(FIXTURES, fixture), 'utf8'), id: 'real' }]), cfg, places, sim);
      return { r, ok: principals(r.decisions).filter((d) => ['confirmado', 'circuito', 'inferido'].includes(d.sentido)) };
    };

    it('Ruta 1 Sur, mapa 1: el sentido coincide con R1S-JOJU-IXT y R1S-IXT-JOJU', () => {
      const { ok } = check('ruta-1-sur-mapa-1.kml', '1.-PUENTE DE IXTLA-JOJUTLA', 'ruta-1-sur');
      expect(ok.map((d) => `${d.origen}→${d.destino}`).sort()).toEqual(['JOJUTLA→PUENTE DE IXTLA', 'PUENTE DE IXTLA→JOJUTLA']);
      for (const name of ['R1S-JOJU-IXT', 'R1S-IXT-JOJU']) {
        const f = labeled.find((x) => x.nombre === name)!;
        // el archivo etiquetado tiene el mismo orden de coordenadas que el trazo con ese origen
        const origin = name.includes('JOJU-IXT') ? 'JOJUTLA' : 'PUENTE DE IXTLA';
        const d = ok.find((x) => x.origen === origin)!;
        expect(Math.abs(d.inicio.coord[0] - f.coords[0][0])).toBeLessThan(0.001);
      }
    });

    it('Ruta 2 Sur, mapa 3: dos duplas (FARMACIA y GAS) y R2S-JOJU-PZONDA corresponde a la de GAS', () => {
      const { r, ok } = check('ruta-2-sur-mapa-3.kml', '3. -JOJUTLA-POZA HONDA', 'ruta-2-sur');
      expect(r.duplas.map((d) => d.variante)).toEqual(['FARMACIA', 'GAS']);
      expect(ok).toHaveLength(4);
      const f = labeled.find((x) => x.nombre === 'R2S-JOJU-PZONDA')!;
      const gasIda = ok.find((d) => d.variante === 'GAS' && d.origen === 'JOJUTLA')!;
      expect(Math.abs(gasIda.inicio.coord[0] - f.coords[0][0])).toBeLessThan(0.001);
    });
  });
});
