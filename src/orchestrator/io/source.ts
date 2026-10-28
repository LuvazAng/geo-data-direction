import { createHash } from 'node:crypto';
import { parseHtml } from './dom';
import { HttpError, type HttpClient } from './http';
import { normalize } from '@core';
import type { OrqConfig } from '../config';

// Adaptador de la fuente. Orden de preferencia (el más sencillo que funcione):
//  1. enlaces directos a .kml/.kmz en el HTML;
//  2. mapas de Google My Maps embebidos (iframe …/maps/d/embed?mid=ID): se descargan con la
//     exportación pública del propio My Maps ("Descargar KML": …/maps/d/kml?mid=ID&forcekml=1).
// Las páginas de Google Sites llegan completas en el HTML estático: no hace falta un navegador.
// Si una página no trae ni enlaces ni mapas se deja un diagnóstico en lugar de adivinar URLs.

export interface MapRef {
  /** mid de My Maps, o "url-<hash>" para un enlace directo. */
  id: string;
  kind: 'mymaps' | 'directo';
  /** Encabezado más cercano antes del mapa (p. ej. "1.-PUENTE DE IXTLA-JOJUTLA"). */
  title: string;
  /** Posición del mapa dentro de su página (1, 2, …). */
  order: number;
  page: string;
  pageSlug: string;
  pageTitle: string;
  downloadUrl: string;
}

export interface PageScan {
  url: string;
  slug: string;
  title: string;
  status: 'ok' | 'error';
  maps: number;
  error?: string;
  diagnostic?: string;
}

export interface SourceScan {
  url: string;
  escaneadoEn: string;
  pages: PageScan[];
  maps: MapRef[];
  diagnostics: string[];
}

const MID_RE = /^[A-Za-z0-9_-]{10,100}$/;
const MYMAPS_PATH = /^\/maps\/d\/(?:u\/\d+\/)?(?:embed|viewer|view)$/;

export const myMapsKmlUrl = (mid: string) => `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`;

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

export const slugOf = (url: string) => {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

/** Subpáginas de una página de zona: enlaces del mismo sitio que cuelgan de su ruta. */
export function extractSubpages(doc: Document, zoneUrl: string): string[] {
  const zone = new URL(zoneUrl);
  const prefix = zone.pathname.replace(/\/$/, '') + '/';
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    let u: URL;
    try {
      u = new URL(a.getAttribute('href')!, zoneUrl);
    } catch {
      continue;
    }
    if (u.origin !== zone.origin || !u.pathname.startsWith(prefix)) continue;
    u.hash = '';
    u.search = '';
    seen.add(u.href); // new URL() ya codifica acentos (circunvalación → %C3%B3)
  }
  return [...seen];
}

/** Mapas y archivos de rutas de una página, en el orden del documento y con su título. */
export function extractMaps(doc: Document, pageUrl: string, hosts: string[]): Omit<MapRef, 'order'>[] {
  const pageTitle = text(doc.querySelector('h1') ?? doc.createElement('x')) || (doc.title ?? '').trim();
  const pageSlug = slugOf(pageUrl);
  const out: Omit<MapRef, 'order'>[] = [];
  const ids = new Set<string>();
  let heading = '';
  for (const el of Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6,iframe[src],a[href]'))) {
    const tag = el.localName;
    if (/^h[1-6]$/.test(tag)) {
      heading = text(el) || heading;
      continue;
    }
    let u: URL;
    try {
      u = new URL(el.getAttribute(tag === 'iframe' ? 'src' : 'href')!, pageUrl);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) continue;
    const mid = u.searchParams.get('mid');
    let ref: Omit<MapRef, 'order'> | null = null;
    if (u.hostname === 'www.google.com' && MYMAPS_PATH.test(u.pathname) && mid && MID_RE.test(mid)) {
      ref = { id: mid, kind: 'mymaps', title: heading, page: pageUrl, pageSlug, pageTitle, downloadUrl: myMapsKmlUrl(mid) };
    } else if (tag === 'a' && /\.(kml|kmz)$/i.test(u.pathname)) {
      const id = 'url-' + createHash('sha256').update(u.href).digest('hex').slice(0, 16);
      const title = text(el) || heading || decodeURIComponent(u.pathname.split('/').pop()!);
      ref = { id, kind: 'directo', title, page: pageUrl, pageSlug, pageTitle, downloadUrl: u.href };
    }
    if (ref && !ids.has(ref.id)) {
      ids.add(ref.id);
      out.push(ref);
    }
  }
  return out;
}

/** Explica por qué una página no dio resultados. */
export function diagnose(html: string, doc: Document): string {
  const reasons: string[] = [];
  const body = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (doc.querySelectorAll('iframe').length === 0 && /atari-embeds|<noscript/i.test(html)) {
    reasons.push('la página usa contenido incrustado que se arma con JavaScript');
  }
  if (body.length < 200) reasons.push('el HTML casi no tiene texto (posible página generada con JavaScript)');
  if (/accounts\.google\.com\/(ServiceLogin|signin)/i.test(html)) reasons.push('la página pide iniciar sesión');
  if (reasons.length === 0) reasons.push('no hay enlaces .kml/.kmz ni mapas de My Maps en el HTML');
  return (
    'Sin mapas ni archivos de rutas: ' +
    reasons.join('; ') +
    '. Haría falta otra estrategia (p. ej. navegador automatizado o acceso autorizado); no se intentó.'
  );
}

const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

const matchesAny = (value: string, filters: string[]) => filters.length === 0 || filters.some((f) => normalize(value).includes(normalize(f)));

async function fetchDoc(http: HttpClient, url: string) {
  const res = await http.get(url);
  const html = decode(res.body);
  return { html, doc: parseHtml(html, res.finalUrl) };
}

/** Recorre la fuente: página de zona → subpáginas → mapas. Los errores por página no detienen el resto. */
export async function scanSource(cfg: OrqConfig, http: HttpClient, onPage?: (p: PageScan) => void): Promise<SourceScan> {
  const { url, hosts, estrategia, subpaginas, mapas } = cfg.fuente;
  const scan: SourceScan = { url, escaneadoEn: new Date().toISOString(), pages: [], maps: [], diagnostics: [] };
  const zone = await fetchDoc(http, url);

  const visit = (pageUrl: string, html: string, doc: Document) => {
    const found = extractMaps(doc, pageUrl, hosts).filter((m) => matchesAny(m.title, mapas));
    found.forEach((m, i) => scan.maps.push({ ...m, order: i + 1 }));
    const page: PageScan = {
      url: pageUrl,
      slug: slugOf(pageUrl),
      title: found[0]?.pageTitle ?? text(doc.querySelector('h1') ?? doc.createElement('x')),
      status: 'ok',
      maps: found.length,
    };
    if (found.length === 0) page.diagnostic = diagnose(html, doc);
    scan.pages.push(page);
    onPage?.(page);
  };

  if (estrategia === 'enlaces-directos') {
    visit(url, zone.html, zone.doc);
    return scan;
  }

  const zoneMaps = extractMaps(zone.doc, url, hosts);
  if (zoneMaps.length) visit(url, zone.html, zone.doc);
  const subs = extractSubpages(zone.doc, url).filter((s) => matchesAny(slugOf(s), subpaginas));
  if (subs.length === 0 && zoneMaps.length === 0) scan.diagnostics.push(diagnose(zone.html, zone.doc));
  if (subpaginas.length && subs.length === 0) scan.diagnostics.push(`Ninguna subpágina coincide con el filtro: ${subpaginas.join(', ')}`);

  for (const sub of subs) {
    try {
      const page = await fetchDoc(http, sub);
      visit(sub, page.html, page.doc);
    } catch (e) {
      const page: PageScan = { url: sub, slug: slugOf(sub), title: '', status: 'error', maps: 0, error: (e as Error).message };
      if (e instanceof HttpError && e.status === 404) page.error += ' (¿cambió la dirección de la página?)';
      scan.pages.push(page);
      onPage?.(page);
    }
  }
  return scan;
}

/**
 * Vuelve a leer sólo algunas subpáginas de un escaneo anterior (ejecución por ruta) y reemplaza
 * sus mapas, conservando el orden y el resto de la fuente.
 */
export async function rescanPages(cfg: OrqConfig, http: HttpClient, cached: SourceScan, slugs: string[], onPage?: (p: PageScan) => void): Promise<SourceScan> {
  const scan: SourceScan = { ...cached, pages: [...cached.pages], maps: [...cached.maps], diagnostics: [] };
  for (const slug of slugs) {
    const i = scan.pages.findIndex((p) => p.slug === slug);
    if (i < 0) throw new Error(`La subpágina ${slug} no está en la fuente guardada; actualiza primero la fuente completa`);
    const url = scan.pages[i].url;
    let page: PageScan;
    let found: MapRef[] = [];
    try {
      const { html, doc } = await fetchDoc(http, url);
      found = extractMaps(doc, url, cfg.fuente.hosts)
        .filter((m) => matchesAny(m.title, cfg.fuente.mapas))
        .map((m, k) => ({ ...m, order: k + 1 }));
      page = { url, slug, title: found[0]?.pageTitle ?? scan.pages[i].title, status: 'ok', maps: found.length };
      if (found.length === 0) page.diagnostic = diagnose(html, doc);
    } catch (e) {
      // Sin acceso a la página se conservan los mapas conocidos
      page = { ...scan.pages[i], status: 'error', error: (e as Error).message };
      found = scan.maps.filter((m) => m.pageSlug === slug);
    }
    scan.pages[i] = page;
    const at = scan.maps.findIndex((m) => m.pageSlug === slug);
    const rest = scan.maps.filter((m) => m.pageSlug !== slug);
    rest.splice(at < 0 ? rest.length : at, 0, ...found);
    scan.maps = rest;
    onPage?.(page);
  }
  scan.escaneadoEn = new Date().toISOString();
  return scan;
}

/** Slugs de las subpáginas de otra zona (para saber qué números de ruta ya existen allí). */
export async function zoneSlugs(http: HttpClient, zoneUrl: string): Promise<string[]> {
  const { doc } = await fetchDoc(http, zoneUrl);
  return extractSubpages(doc, zoneUrl).map(slugOf);
}
