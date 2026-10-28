import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { downloadMaps, kmlTextOf } from '../../../src/orchestrator/io/download';
import { HttpClient, type HttpPolicy } from '../../../src/orchestrator/io/http';
import { myMapsKmlUrl, type MapRef } from '../../../src/orchestrator/io/source';
import { Workspace } from '../../../src/orchestrator/io/store';
import { analyzeKml } from '../../../src/orchestrator/domain/traces';
import { fakeFetch, itin, JOJUTLA, kml, line, PUENTE_IXTLA, tmp } from '../../helpers';

const policy: HttpPolicy = { hosts: ['www.google.com'], timeoutMs: 2000, maxBytes: 1_000_000, reintentos: 1, pausaMs: 0, userAgent: 'prueba' };
const VALID = kml('1. JOJUTLA-PUENTE DE IXTLA', [itin('JOJUTLA-PUENTE DE IXTLA', line(JOJUTLA, PUENTE_IXTLA))]);
const enc = (s: string) => new TextEncoder().encode(s);

async function kmz(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('archivos KML/KMZ inválidos (caso 5)', () => {
  it('acepta un KML con trazos y un KMZ con doc.kml', async () => {
    expect(await kmlTextOf(enc(VALID), 1e6)).toContain('<kml');
    expect(await kmlTextOf(await kmz({ 'doc.kml': VALID, 'files/icono.png': 'png' }), 1e6)).toContain('JOJUTLA');
  });

  it.each([
    ['una página de error HTML', '<html><body>Necesitas permiso</body></html>', /No es KML/],
    ['un KML truncado', VALID.slice(0, VALID.length / 2), /KML inválido/],
    [
      'un KML sin LineString',
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point><coordinates>-99,18,0</coordinates></Point></Placemark></Document></kml>',
      /LineString/,
    ],
  ])('rechaza %s', async (_, text, msg) => {
    await expect(kmlTextOf(enc(text), 1e6)).rejects.toThrow(msg);
  });

  it('rechaza un KMZ sin .kml', async () => {
    await expect(kmlTextOf(await kmz({ 'leeme.txt': 'hola' }), 1e6)).rejects.toThrow(/no contiene/);
  });

  it('un KMZ con rutas engañosas no se extrae a disco (se lee en memoria)', async () => {
    const bad = await kmz({ '../../fuera.kml': VALID });
    expect(await kmlTextOf(bad, 1e6)).toContain('JOJUTLA');
  });

  it('un trazo con menos de 2 puntos se descarta y se reporta', () => {
    const text = kml('X', [itin('A-B', line(JOJUTLA, PUENTE_IXTLA)), { coords: [JOJUTLA], props: {} }]);
    const r = analyzeKml('m', text);
    expect(r.traces).toHaveLength(1);
    expect(r.anomalies.join()).toMatch(/menos de 2 puntos/);
  });
});

describe('interrupción y reanudación de un lote (caso 13)', () => {
  const refs: MapRef[] = ['aaaaaaaaaaaa1', 'aaaaaaaaaaaa2', 'aaaaaaaaaaaa3'].map((id, i) => ({
    id,
    kind: 'mymaps',
    title: `${i + 1}. MAPA`,
    order: i + 1,
    page: 'https://sites.google.com/view/p/sur/r',
    pageSlug: 'r',
    pageTitle: 'R',
    downloadUrl: myMapsKmlUrl(id),
  }));

  it('después de un corte retoma sólo lo pendiente y no repite descargas', async () => {
    const ws = new Workspace(tmp(), 'LOTE');
    const routes = Object.fromEntries(refs.map((r) => [r.downloadUrl, { body: VALID }]));
    const state = ws.loadState('fuente', 'LOTE');
    await downloadMaps(refs.slice(0, 1), state, ws, new HttpClient(policy, fakeFetch(routes).impl, async () => {}), 1e6);
    // el proceso murió mientras descargaba el segundo mapa: así queda el estado en disco
    state.mapas[refs[1].id] = {
      id: refs[1].id,
      title: '',
      pageSlug: 'r',
      downloadUrl: refs[1].downloadUrl,
      estado: 'DESCARGANDO',
      intentos: 0,
      actualizadoEn: '',
    };
    ws.saveState(state);

    const resumed = ws.loadState('fuente', 'LOTE');
    expect(resumed.mapas[refs[0].id].estado).toBe('DESCARGADO');
    expect(resumed.mapas[refs[1].id].estado).toBe('PENDIENTE');

    const second = fakeFetch(routes);
    const r = await downloadMaps(refs, resumed, ws, new HttpClient(policy, second.impl, async () => {}), 1e6);
    expect(r).toMatchObject({ descargados: 2, yaEstaban: 1, errores: 0 });
    expect(second.calls).toEqual([refs[1].downloadUrl, refs[2].downloadUrl]);
  });

  it('marca como ERROR lo que no se puede descargar y lo reintenta en la siguiente corrida', async () => {
    const ws = new Workspace(tmp(), 'LOTE');
    const state = ws.loadState('fuente', 'LOTE');
    const down = fakeFetch({ [refs[0].downloadUrl]: { status: 403 } });
    await downloadMaps(refs.slice(0, 1), state, ws, new HttpClient(policy, down.impl, async () => {}), 1e6);
    expect(state.mapas[refs[0].id]).toMatchObject({ estado: 'ERROR' });
    expect(state.mapas[refs[0].id].error).toMatch(/403/);
    const up = fakeFetch({ [refs[0].downloadUrl]: { body: VALID } });
    await downloadMaps(refs.slice(0, 1), state, ws, new HttpClient(policy, up.impl, async () => {}), 1e6);
    expect(state.mapas[refs[0].id].estado).toBe('DESCARGADO');
  });

  it('un archivo con el mismo contenido que otro se reporta como duplicado', async () => {
    const ws = new Workspace(tmp(), 'LOTE');
    const routes = Object.fromEntries(refs.slice(0, 2).map((r) => [r.downloadUrl, { body: VALID }]));
    const r = await downloadMaps(refs.slice(0, 2), ws.loadState('f', 'LOTE'), ws, new HttpClient(policy, fakeFetch(routes).impl, async () => {}), 1e6);
    expect(r.duplicados).toEqual([{ id: refs[1].id, igualA: refs[0].id }]);
  });
});
