import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKml, type Coord } from '@core';
import { HttpClient } from '../../../src/orchestrator/io/http';
import type { MapQuestion, QwenClient } from '../../../src/orchestrator/llm/llm';
import { run } from '../../../src/orchestrator/pipeline/pipeline';
import { decideMap, evaluateMap } from '../../../src/orchestrator/pipeline/reviews';
import { myMapsKmlUrl } from '../../../src/orchestrator/io/source';
import {
  COLONIAS_DIR,
  fakeFetch,
  hasColonias,
  INEGI_DIR,
  itin,
  JOJUTLA,
  kml,
  line,
  path,
  PUENTE_IXTLA,
  shift,
  sitesPage,
  testConfig,
  tmp,
} from '../../helpers';

const ZONE = 'https://sites.google.com/view/prueba/sur';
const CENTRO = 'https://sites.google.com/view/prueba/centro';
const SUB = `${ZONE}/ruta-1-sur`;
const M1 = '1bJBY3fptaCuBN8BlLsHWRJJH3u8JCDq1';
const M2 = '12cT98X-HNzYG_Z_MchINhOUQ79RRM4eB';
const M3 = '1eI8yxVhijeKDKwofcY6cZqbALKdKOV88';
const MID: Coord = [-99.25, 18.64];
const ida = path(JOJUTLA, MID, PUENTE_IXTLA);
const a: Coord = [-99.1785, 18.6155];
const b: Coord = [-99.1745, 18.6125];

function site() {
  return fakeFetch({
    [ZONE]: { body: `<h1>SUR</h1><a href="/view/prueba/sur/ruta-1-sur">RUTA 1</a><img src="https://sites.google.com/x.png">` },
    [CENTRO]: { body: `<a href="/view/prueba/centro/ruta-1">RUTA 1</a>` },
    [SUB]: {
      body: sitesPage('RUTA 1 SUR', [
        { heading: '1.-JOJUTLA-PUENTE DE IXTLA', mid: M1 },
        { heading: '2.-PRIVADO', mid: M2 },
        { heading: '3. CENTRO-COL. LAS FLORES-CENTRO', mid: M3 },
      ]),
    },
    [myMapsKmlUrl(M1)]: {
      body: kml('1. JOJUTLA-PUENTE DE IXTLA-JOJUTLA', [itin('JOJUTLA-PUENTE DE IXTLA', ida), itin('PUENTE DE IXTLA-JOJUTLA', shift([...ida].reverse(), 10))]),
      headers: { 'content-type': 'text/xml' },
    },
    [myMapsKmlUrl(M2)]: { status: 403 },
    [myMapsKmlUrl(M3)]: {
      body: kml('3. CENTRO-COL. LAS FLORES-CENTRO', [itin('CENTRO-COL. LAS FLORES', line(a, b)), itin('COL. LAS FLORES-CENTRO', line(b, a))]),
    },
  });
}

/** Qwen simulado: propone un origen/destino que la geometría no puede confirmar. */
function fakeQwen(calls: string[]): QwenClient {
  return {
    available: async () => ({ ok: true, detalle: 'qwen3.5:4b disponible (simulado)' }),
    interpretMap: async (q: MapQuestion) => {
      calls.push(q.mapa);
      return {
        answer: {
          trazos: q.trazos.map((t) => ({
            indice: t.indice,
            origen: 'CENTRO',
            destino: 'COL. LAS FLORES',
            via: null,
            rol: 'ida' as const,
            confianza: 'baja' as const,
          })),
          explicacion: 'Ambos extremos están en Jojutla.',
        },
        descartes: [],
        cached: false,
        ms: 1,
      };
    },
  } as unknown as QwenClient;
}

describe('orquestador de principio a fin', () => {
  it('descarga, clasifica, nombra, genera, reporta y es idempotente', async () => {
    const work = tmp();
    const cfg = testConfig(work, {
      fuente: { url: ZONE, zonasReferencia: [CENTRO] } as never,
      nomenclatura: { localidades: { 'PUENTE DE IXTLA': 'IXT', JOJUTLA: 'JOJU' } } as never,
      ia: { habilitada: true, url: 'http://127.0.0.1:11434', modelo: 'qwen3.5:4b', timeoutMs: 1000, reintentos: 0 },
    });
    const qwenCalls: string[] = [];
    const s = site();
    const r1 = await run(cfg, { http: new HttpClient(cfg.fuente, s.impl, async () => {}), qwen: fakeQwen(qwenCalls) });

    const root = join(work, 'PRUEBA', 'resultados');
    expect(existsSync(join(root, 'SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml'))).toBe(true);
    expect(existsSync(join(root, 'SUR/RUTA-1-SUR/1/R1S-IXT-JOJU.kml'))).toBe(true);
    const out = readFileSync(join(root, 'SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml'), 'utf8');
    expect(out).toContain('<name>INICIO</name>');
    expect(out).toContain('DESCRIPCIO'); // se conservan los metadatos

    // 403: inaccesible, con explicación, sin intentar evadirlo
    expect(r1.state.mapas[M2]).toMatchObject({ estado: 'ERROR' });
    expect(r1.state.mapas[M2].error).toMatch(/no permite exportarlo/);

    // sin evidencia: Qwen propone, la geometría no confirma, queda en revisión (copia en _REVISION)
    expect(qwenCalls).toEqual(['3. CENTRO-COL. LAS FLORES-CENTRO']);
    const rev = r1.report.trazos.filter((t) => t.estado === 'REQUIERE_REVISION');
    expect(rev).toHaveLength(2);
    expect(r1.report.ia.intervenciones[0].cambios.join()).toMatch(/descartada/);
    expect(r1.state.mapas[M3].estado).toBe('REQUIERE_REVISION');
    expect(r1.state.mapas[M1].estado).toBe('GENERADO');

    expect(r1.report.resumen).toMatchObject({ mapasEncontrados: 3, mapasConError: 1, generados: 2, requierenRevision: 2 });
    expect(r1.report.codigos.rutas[0]).toMatchObject({ codigo: 'R1S' });
    expect(readFileSync(join(work, 'PRUEBA', 'reporte.md'), 'utf8')).toMatch(/Archivos generados/);

    // lo opcional que no está (casos etiquetados, colonias) se avisa; no es un error
    expect(r1.resumen.advertencias.some((a) => a.startsWith('Sin casos etiquetados'))).toBe(true);
    expect(r1.resumen.advertencias.some((a) => a.startsWith('Sin colonias'))).toBe(true);
    expect(r1.resumen.errores.filter((e) => /colonias|etiquetados/i.test(e))).toEqual([]);

    // segunda corrida sin red sobre los originales guardados: nada cambia
    const r2 = await run(cfg, { sinRed: true, qwen: fakeQwen(qwenCalls) });
    expect(r2.report.salida).toMatchObject({ escritos: [], actualizados: [], obsoletos: [], conflictos: [] });
    expect(r2.report.salida!.sinCambios).toHaveLength(r1.report.salida!.escritos.length);
  });

  it.skipIf(!hasColonias)('cada KML generado lleva las colonias por las que pasa', async () => {
    const work = tmp();
    const cfg = testConfig(work, {
      fuente: { url: ZONE, zonasReferencia: [CENTRO] } as never,
      nomenclatura: { localidades: { 'PUENTE DE IXTLA': 'IXT', JOJUTLA: 'JOJU' } } as never,
      dirs: { trabajo: work, existentes: join(work, 'no-existe'), inegi: INEGI_DIR, colonias: COLONIAS_DIR },
    });
    await run(cfg, { http: new HttpClient(cfg.fuente, site().impl, async () => {}) });
    const props = parseKml(readFileSync(join(work, 'PRUEBA', 'resultados', 'SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml'), 'utf8')).props;
    expect(props.COLONIAS).toMatch(/^[^;]+, JOJUTLA; /);
    expect(props.COLONIAS).toMatch(/, PUENTE DE IXTLA$/);
  });

  it('si las colonias no se pueden leer, se reporta y se genera sin ellas', async () => {
    const work = tmp();
    mkdirSync(join(work, 'colonias-rotas'));
    const cfg = testConfig(work, {
      fuente: { url: ZONE, zonasReferencia: [CENTRO] } as never,
      nomenclatura: { localidades: { 'PUENTE DE IXTLA': 'IXT', JOJUTLA: 'JOJU' } } as never,
      dirs: { trabajo: work, existentes: join(work, 'no-existe'), inegi: INEGI_DIR, colonias: join(work, 'colonias-rotas') },
    });
    const r = await run(cfg, { http: new HttpClient(cfg.fuente, site().impl, async () => {}) });
    expect(r.report.errores.some((e) => e.startsWith('Colonias') && e.includes('colonias-rotas'))).toBe(true);
    const out = readFileSync(join(work, 'PRUEBA', 'resultados', 'SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml'), 'utf8');
    expect(out).not.toContain('COLONIAS');
  });

  it('un mapa evaluado a mano conserva sus carpetas al volver a procesar y uno descartado no genera nada', async () => {
    const [SIN, OTRO] = ['1aAmpliacionesSoloxxxxxxxxxxxxxx', '1bOtroSinItinerariosxxxxxxxxxxxx'];
    const ampl = (name: string, coords: Coord[]) => ({ name, coords, props: { 'AUTO-AMPL': 'AMPLIACION' } });
    const fetch = fakeFetch({
      [ZONE]: { body: `<h1>SUR</h1><a href="/view/prueba/sur/ruta-1-sur">RUTA 1</a>` },
      [SUB]: {
        body: sitesPage('RUTA 1 SUR', [
          { heading: '1.-JOJUTLA-TEHUIXTLA', mid: SIN },
          { heading: '2.-JOJUTLA-PUENTE DE IXTLA', mid: M1 },
          { heading: '3.-AMPLIACIONES', mid: OTRO },
        ]),
      },
      [myMapsKmlUrl(SIN)]: { body: kml('1.-JOJUTLA-TEHUIXTLA', [ampl('AMPL. IDA', line(JOJUTLA, MID)), ampl('AMPL. REGRESO', line(MID, JOJUTLA))]) },
      [myMapsKmlUrl(M1)]: {
        body: kml('2. JOJUTLA-PUENTE DE IXTLA-JOJUTLA', [itin('JOJUTLA-PUENTE DE IXTLA', ida), itin('PUENTE DE IXTLA-JOJUTLA', shift([...ida].reverse(), 10))]),
      },
      [myMapsKmlUrl(OTRO)]: { body: kml('3.-AMPLIACIONES', [ampl('AMPL. CENTRO', line(JOJUTLA, MID))]) },
    });
    const work = tmp();
    const cfg = testConfig(work, { fuente: { url: ZONE } as never, nomenclatura: { localidades: { 'PUENTE DE IXTLA': 'IXT', JOJUTLA: 'JOJU' } } as never });
    const lote = { lote: cfg.lote, zona: cfg.zona, fuente: cfg.fuente.url, archivo: '', raiz: join(work, cfg.lote), config: cfg };
    const root = join(work, 'PRUEBA', 'resultados', 'SUR', 'RUTA-1-SUR');

    const r1 = await run(cfg, { http: new HttpClient(cfg.fuente, fetch.impl, async () => {}) });
    expect(r1.state.mapas[SIN]).toMatchObject({ estado: 'REQUIERE_REVISION', error: 'sin itinerarios utilizables: 2 ampliación(es)' });
    expect(existsSync(join(root, '1', 'R1-JOJU-IXT.kml'))).toBe(true);

    const traza = (i: number) => `${SIN}#${i}`;
    const single = (name: string, coords: Coord[]) => kml(name, [{ name, coords }]);
    evaluateMap(lote, {
      mapa: SIN,
      generar: [
        { traza: traza(0), nombre: 'R1S-JOJU-TEHU', contenidoKml: single('R1S-JOJU-TEHU', line(JOJUTLA, MID)), dupla: 1 },
        { traza: traza(1), nombre: 'R1S-TEHU-JOJU', contenidoKml: single('R1S-TEHU-JOJU', line(MID, JOJUTLA)), dupla: 1 },
      ],
      descartar: [],
    });
    decideMap(lote, OTRO, 'descartar');
    expect(existsSync(join(root, '1', 'R1S-JOJU-TEHU.kml'))).toBe(true);
    expect(existsSync(join(root, '2', 'R1-JOJU-IXT.kml'))).toBe(true);

    const r2 = await run(cfg, { sinRed: true });
    expect(r2.state.mapas[SIN].estado).toBe('GENERADO');
    expect(r2.state.mapas[OTRO].estado).toBe('DESCARTADO');
    expect(r2.state.mapas[M1].estado).toBe('GENERADO');
    expect(r2.report.salida).toMatchObject({ escritos: [], actualizados: [], obsoletos: [], conflictos: [] });
    expect(existsSync(join(root, '1', 'R1S-JOJU-TEHU.kml'))).toBe(true);
    expect(existsSync(join(root, '2', 'R1-JOJU-IXT.kml'))).toBe(true);
    expect(existsSync(join(root, '1', 'R1-JOJU-IXT.kml'))).toBe(false);
  });
});
