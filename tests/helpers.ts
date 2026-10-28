import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Coord } from '@core';
import { validateConfig, type OrqConfig } from '../src/orchestrator/config';
import type { FetchLike } from '../src/orchestrator/io/http';
import { dataDirs, loadEnv } from '../src/orchestrator/paths';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = resolve(HERE, 'fixtures');
// Extracto mínimo del INEGI (Jojutla y Puente de Ixtla): la clasificación y el orquestador se prueban en cualquier copia
export const INEGI_DIR = resolve(FIXTURES, 'inegi/conjunto_de_datos');
// Datos reales completos, opcionales (ver data/README.md): complementan las pruebas cuando están
loadEnv();
export const INEGI_REAL_DIR = dataDirs().inegi;
export const hasInegiReal = existsSync(join(INEGI_REAL_DIR, '17l.shp'));
export const COLONIAS_DIR = dataDirs().colonias;
export const hasColonias = existsSync(join(COLONIAS_DIR, 'COLONIA.shp'));

// Puntos reales (extremos de la Ruta 1 Sur, mapa 1)
export const JOJUTLA: Coord = [-99.17783, 18.61556];
export const PUENTE_IXTLA: Coord = [-99.32413, 18.61675];

/** Recta de a a b con un vértice cada ~stepM metros. */
export function line(a: Coord, b: Coord, stepM = 50): Coord[] {
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (b[1] - a[1]) * 110_540;
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dy) / stepM) + 1);
  return Array.from({ length: n }, (_, i): Coord => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)]);
}

/** Polilínea por varios puntos. */
export const path = (...pts: Coord[]): Coord[] => pts.slice(1).flatMap((p, i) => line(pts[i], p).slice(i === 0 ? 0 : 1));

/** Desplaza una línea unos metros hacia el norte (ruido de GPS / otra calle paralela). */
export const shift = (coords: Coord[], northM: number): Coord[] => coords.map(([x, y]) => [x, y + northM / 110_540]);

export interface PlacemarkSpec {
  name?: string;
  coords: Coord[];
  props?: Record<string, string>;
}

export function kml(docName: string, placemarks: PlacemarkSpec[]): string {
  const pm = placemarks
    .map(
      (p) => `    <Placemark>
      <name>${p.name ?? docName}</name>
      <ExtendedData>${Object.entries(p.props ?? {})
        .map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`)
        .join('')}</ExtendedData>
      <LineString><coordinates>${p.coords.map(([x, y]) => `${x},${y},0`).join(' ')}</coordinates></LineString>
    </Placemark>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name>
${pm}
  </Document>
</kml>
`;
}

export const itin = (descripcio: string, coords: Coord[], extra: Record<string, string> = {}): PlacemarkSpec => ({
  coords,
  props: { RUTA: 'RUTA 1', DESCRIPCIO: descripcio, 'AUTO-AMPL': 'ITINERARIO', ...extra },
});

export interface FakeResponse {
  status?: number;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  /** Lanza un error de red en lugar de responder. */
  error?: string;
}

/** fetch simulado: por URL, una respuesta o una lista (una por intento). Registra las peticiones. */
export function fakeFetch(routes: Record<string, FakeResponse | FakeResponse[]>) {
  const calls: string[] = [];
  const counters = new Map<string, number>();
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const spec = routes[url];
    if (!spec) return new Response('no encontrado', { status: 404 });
    const i = counters.get(url) ?? 0;
    counters.set(url, i + 1);
    const r = Array.isArray(spec) ? spec[Math.min(i, spec.length - 1)] : spec;
    if (r.error) throw new TypeError(r.error);
    const body = r.body ?? '';
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: r.status ?? 200, headers: r.headers });
  };
  return { impl, calls };
}

export const tmp = (prefix = 'orq-') => mkdtempSync(join(tmpdir(), prefix));

/**
 * Respuesta en streaming como la de Ollama: una línea JSON por lectura (con `delayMs` entre una y
 * otra, como un modelo escribiendo); con `hang`, se queda abierta hasta que se aborte.
 */
export function ollamaStream(chunks: object[], opts: { hang?: boolean; signal?: AbortSignal | null; delayMs?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(c) {
        if (i < chunks.length && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (i < chunks.length) return c.enqueue(enc.encode(`${JSON.stringify(chunks[i++])}\n`));
        if (!opts.hang) return c.close();
        return new Promise<void>((resolve) => {
          const fail = () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            c.error(e);
            resolve();
          };
          if (opts.signal?.aborted) fail();
          else opts.signal?.addEventListener('abort', fail, { once: true });
        });
      },
    }),
  );
}

export function testConfig(work: string, over: Partial<OrqConfig> = {}): OrqConfig {
  const base: OrqConfig = {
    lote: 'PRUEBA',
    zona: 'SUR',
    fuente: {
      url: 'https://sites.google.com/view/prueba/sur',
      estrategia: 'google-sites',
      hosts: ['sites.google.com', 'www.google.com'],
      subpaginas: [],
      mapas: [],
      zonasReferencia: [],
      timeoutMs: 5000,
      maxBytes: 5 * 1024 * 1024,
      reintentos: 2,
      pausaMs: 1,
      userAgent: 'prueba',
    },
    dirs: { trabajo: work, existentes: join(work, 'no-existe'), inegi: INEGI_DIR, colonias: join(work, 'no-existe-colonias') },
    similitud: { toleranciaM: 25, identicoM: 1, casiIdentico: 0.95, longitudCasiIdentica: 0.9, parcial: 0.3, duplaMin: 0.4, celdaM: 150, candidatoMin: 0.2 },
    extremos: { maxDistanciaM: 2000, terminalM: 300 },
    nomenclatura: {
      patron: '{ruta}-{origen}-{destino}{via}',
      patronCircuito: '{ruta}-{origen}-{destino}{via}',
      letraZona: { SUR: 'S', ORIENTE: 'O' },
      rutas: {},
      rutasBase: {},
      localidades: {},
      vias: {},
      incluirVia: 'si-hay-varias',
      alias: {},
      codigoNuevo: 'sugerir',
      colision: 'sufijo',
    },
    ia: { habilitada: false, url: 'http://127.0.0.1:11434', modelo: 'qwen3.5:4b', timeoutMs: 5000, reintentos: 1 },
    salida: { soloPrincipales: true, copiarRevision: true },
  };
  return validateConfig({ ...base, ...over, fuente: { ...base.fuente, ...over.fuente }, nomenclatura: { ...base.nomenclatura, ...over.nomenclatura } });
}

/** Página de Google Sites mínima: título, encabezados y mapas de My Maps (y lo que se agregue). */
export function sitesPage(title: string, maps: { heading: string; mid: string }[], extra = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>
  <h1>${title}</h1>
  ${maps.map((m) => `<h2>${m.heading}</h2><div><iframe src="https://www.google.com/maps/d/embed?mid=${m.mid}" allowfullscreen></iframe></div>`).join('\n')}
  ${extra}
  <p>${'texto '.repeat(60)}</p>
  </body></html>`;
}
