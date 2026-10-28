import { describe, expect, it } from 'vitest';
import { parseHtml } from '../../../src/orchestrator/io/dom';
import { HttpClient } from '../../../src/orchestrator/io/http';
import { diagnose, extractMaps, extractSubpages, myMapsKmlUrl, scanSource } from '../../../src/orchestrator/io/source';
import { fakeFetch, sitesPage, testConfig, tmp } from '../../helpers';

const HOSTS = ['sites.google.com', 'www.google.com'];
const PAGE = 'https://sites.google.com/view/prueba/sur/ruta-1-sur';

describe('fuente: página con enlaces directos a KML/KMZ (caso 1)', () => {
  it('encuentra los .kml y .kmz con su texto como título', () => {
    const doc = parseHtml(
      `<h1>Rutas</h1><a href="/files/ruta-1.kml">Ruta 1 ida</a> <a href="https://sites.google.com/x/ruta-2.KMZ">Ruta 2</a>`,
      'https://sites.google.com/view/prueba/descargas',
    );
    const maps = extractMaps(doc, 'https://sites.google.com/view/prueba/descargas', HOSTS);
    expect(maps.map((m) => [m.kind, m.title, m.downloadUrl])).toEqual([
      ['directo', 'Ruta 1 ida', 'https://sites.google.com/files/ruta-1.kml'],
      ['directo', 'Ruta 2', 'https://sites.google.com/x/ruta-2.KMZ'],
    ]);
  });

  it('con la estrategia enlaces-directos descarga sólo desde la página configurada', async () => {
    const url = 'https://sites.google.com/view/prueba/descargas';
    const { impl } = fakeFetch({ [url]: { body: '<a href="/a.kml">A</a><a href="/b.pdf">B</a>' } });
    const cfg = testConfig(tmp(), { fuente: { url, estrategia: 'enlaces-directos' } as never });
    const scan = await scanSource(cfg, new HttpClient(cfg.fuente, impl, async () => {}));
    expect(scan.maps.map((m) => m.downloadUrl)).toEqual(['https://sites.google.com/a.kml']);
  });
});

describe('fuente: página con recursos que no son rutas (caso 2)', () => {
  it('sólo toma mapas de My Maps y archivos de rutas de hosts permitidos, con el encabezado más cercano', () => {
    const html = sitesPage(
      'RUTA 1 SUR',
      [
        { heading: '1.-PUENTE DE IXTLA-JOJUTLA', mid: '1bJBY3fptaCuBN8BlLsHWRJJH3u8JCDq1' },
        { heading: '2.-PUENTE DE IXTLA-MICHAPA', mid: '1lniPh6ieK39-2PU1l8h3Yy1-fSnjDu9_' },
      ],
      `<img src="https://sites.google.com/sitesv-images-rt/foto.png">
       <a href="https://morelos.gob.mx/">Gobierno</a>
       <a href="https://otro-sitio.com/ruta.kml">kml de otro host</a>
       <a href="https://sites.google.com/view/prueba/folleto.pdf">PDF</a>
       <iframe src="https://www.youtube.com/embed/xyz"></iframe>
       <iframe src="https://www.google.com/maps/d/embed?mid=1bJBY3fptaCuBN8BlLsHWRJJH3u8JCDq1"></iframe>`,
    );
    const maps = extractMaps(parseHtml(html, PAGE), PAGE, HOSTS);
    expect(maps).toHaveLength(2); // el repetido no se cuenta dos veces
    expect(maps[0]).toMatchObject({
      kind: 'mymaps',
      id: '1bJBY3fptaCuBN8BlLsHWRJJH3u8JCDq1',
      title: '1.-PUENTE DE IXTLA-JOJUTLA',
      pageTitle: 'RUTA 1 SUR',
      pageSlug: 'ruta-1-sur',
    });
    expect(maps[1].title).toBe('2.-PUENTE DE IXTLA-MICHAPA');
    expect(maps[0].downloadUrl).toBe(myMapsKmlUrl('1bJBY3fptaCuBN8BlLsHWRJJH3u8JCDq1'));
  });

  it('las subpáginas son sólo las que cuelgan de la zona, y las direcciones con acento quedan codificadas', () => {
    const zone = 'https://sites.google.com/view/prueba/sur';
    const doc = parseHtml(
      `<a href="/view/prueba/sur/ruta-1-sur">1</a>
       <a href="/view/prueba/sur/ruta-1-sur#h.abc">1 otra vez</a>
       <a href="/view/prueba/sur/autobuses-circunvalación-jojutla">acento</a>
       <a href="/view/prueba/centro/ruta-1">otra zona</a>
       <a href="https://morelos.gob.mx/">fuera</a>`,
      zone,
    );
    expect(extractSubpages(doc, zone)).toEqual([
      'https://sites.google.com/view/prueba/sur/ruta-1-sur',
      'https://sites.google.com/view/prueba/sur/autobuses-circunvalaci%C3%B3n-jojutla',
    ]);
  });
});

describe('fuente: página que depende de JavaScript (caso 4)', () => {
  it('sin mapas en el HTML deja un diagnóstico en lugar de adivinar direcciones', async () => {
    const zone = 'https://sites.google.com/view/prueba/sur';
    const html = '<html><body><div class="x" data-src="atari-embeds"></div><noscript>Activa JavaScript</noscript></body></html>';
    const { impl, calls } = fakeFetch({ [zone]: { body: html } });
    const cfg = testConfig(tmp());
    const scan = await scanSource(cfg, new HttpClient(cfg.fuente, impl, async () => {}));
    expect(scan.maps).toHaveLength(0);
    expect(scan.diagnostics[0]).toMatch(/JavaScript/);
    expect(scan.diagnostics[0]).toMatch(/no se intentó/);
    expect(calls).toEqual([zone]); // no se inventaron más peticiones
    expect(diagnose(html, parseHtml(html, zone))).toMatch(/JavaScript/);
  });

  it('una subpágina caída no detiene a las demás', async () => {
    const zone = 'https://sites.google.com/view/prueba/sur';
    const ok = `${zone}/ruta-2-sur`;
    const { impl } = fakeFetch({
      [zone]: { body: `<a href="/view/prueba/sur/ruta-1-sur">1</a><a href="/view/prueba/sur/ruta-2-sur">2</a>` },
      [ok]: { body: sitesPage('RUTA 2 SUR', [{ heading: '1. JOJUTLA-TETELPA', mid: '1gsDwgQ1WIy9ELnr3x_XFl3Y1XNtr5r-m' }]) },
    });
    const cfg = testConfig(tmp());
    const scan = await scanSource(cfg, new HttpClient(cfg.fuente, impl, async () => {}));
    expect(scan.pages.map((p) => [p.slug, p.status])).toEqual([
      ['ruta-1-sur', 'error'],
      ['ruta-2-sur', 'ok'],
    ]);
    expect(scan.maps).toHaveLength(1);
  });
});
