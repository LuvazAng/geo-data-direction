import JSZip from 'jszip';

// Mismas convenciones que geo-data-routes/import_routes.js
export const START_MARKER_NAMES = ['INICIO', 'START', 'ORIGEN'];
export const END_MARKER_NAMES = ['FINAL', 'FIN', 'END', 'DESTINO'];

export type Coord = [number, number];

/** Un trazo (Placemark con LineString) dentro de un archivo KML/KMZ. */
export interface ParsedKml {
  /** Texto KML original completo (sin modificar). */
  text: string;
  /** Posición del trazo entre los Placemark con LineString del archivo. */
  index: number;
  /** Cuántos trazos trae el archivo. */
  count: number;
  /** Carpetas (<Folder>) que contienen al trazo dentro del KML, de afuera hacia adentro. */
  folderPath: string[];
  /** Nombre del Placemark que contiene el trazo. */
  name: string;
  /** ExtendedData del Placemark (Data/value y SimpleData). */
  props: Record<string, string>;
  /** Coordenadas del trazo en el orden en que vienen en el archivo. */
  coords: Coord[];
  /** Marcadores INICIO/FINAL que ya trae el archivo, si existen. */
  markers: { start?: Coord; end?: Coord };
}

const byLocal = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagNameNS('*', tag));

const childByLocal = (el: Element, tag: string) => Array.from(el.children).find((c) => c.localName === tag);

const placemarkName = (pm: Element) => (childByLocal(pm, 'name')?.textContent ?? '').trim();

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('KML inválido: ' + (err.textContent ?? '').slice(0, 200));
  return doc;
}

const splitTuples = (text: string) => text.trim().split(/\s+/).filter(Boolean);

const tupleToCoord = (t: string): Coord => {
  const [lng, lat] = t.split(',').map(Number);
  return [lng, lat];
};

/** Placemarks que contienen uno o más LineString (directo o en MultiGeometry). */
const linePlacemarks = (doc: Document) => byLocal(doc, 'Placemark').filter((p) => byLocal(p, 'LineString').length > 0);

const coordElements = (pm: Element) =>
  byLocal(pm, 'LineString')
    .map((ls) => childByLocal(ls, 'coordinates'))
    .filter((c): c is Element => !!c);

/** Primer Placemark con LineString. */
function findLinePlacemark(doc: Document) {
  const pm = linePlacemarks(doc)[0];
  return pm ? { pm, coordEls: coordElements(pm) } : null;
}

function folderPathOf(pm: Element): string[] {
  const path: string[] = [];
  for (let p = pm.parentElement; p; p = p.parentElement) {
    if (p.localName === 'Folder') path.unshift(placemarkName(p) || 'Carpeta');
  }
  return path;
}

function markerPlacemarks(root: Document | Element) {
  const result: { el: Element; kind: 'start' | 'end'; coord: Coord }[] = [];
  for (const pm of byLocal(root, 'Placemark')) {
    const pt = byLocal(pm, 'Point')[0];
    if (!pt) continue;
    const name = placemarkName(pm).toUpperCase();
    const kind = START_MARKER_NAMES.includes(name) ? 'start' : END_MARKER_NAMES.includes(name) ? 'end' : null;
    if (!kind) continue;
    const c = childByLocal(pt, 'coordinates')?.textContent;
    if (c) result.push({ el: pm, kind, coord: tupleToCoord(splitTuples(c)[0]) });
  }
  return result;
}

/** Todos los trazos (Placemark con LineString) del archivo, en orden. */
export function parseKmlAll(text: string): ParsedKml[] {
  const doc = parseXml(text);
  const lines = linePlacemarks(doc);
  if (lines.length === 0) throw new Error('No se encontró un LineString en el KML.');

  return lines.flatMap((pm, index) => {
    const coords = coordElements(pm).flatMap((c) => splitTuples(c.textContent ?? '').map(tupleToCoord));
    if (coords.length < 2) return [];

    const props: Record<string, string> = {};
    for (const d of byLocal(pm, 'Data')) {
      const key = d.getAttribute('name');
      const val = (byLocal(d, 'value')[0]?.textContent ?? '').trim();
      if (key && val) props[key] = val;
    }
    for (const d of byLocal(pm, 'SimpleData')) {
      const key = d.getAttribute('name');
      const val = (d.textContent ?? '').trim();
      if (key && val) props[key] = val;
    }

    // Con un solo trazo, los INICIO/FINAL del archivo son suyos. Con varios, sólo los
    // que estén en la misma carpeta y si esa carpeta no tiene otro trazo.
    const container = lines.length === 1 ? doc : pm.parentElement;
    const markers: ParsedKml['markers'] = {};
    if (container && (lines.length === 1 || linePlacemarks(doc).filter((l) => l.parentElement === container).length === 1)) {
      for (const m of markerPlacemarks(container)) markers[m.kind] = m.coord;
    }

    return [{ text, index, count: lines.length, folderPath: folderPathOf(pm), name: placemarkName(pm), props, coords, markers }];
  });
}

/** El primer trazo del archivo. */
export const parseKml = (text: string): ParsedKml => parseKmlAll(text)[0];

const FEATURES = new Set(['Placemark', 'Folder', 'Document', 'NetworkLink', 'GroundOverlay', 'ScreenOverlay', 'PhotoOverlay']);

/**
 * Deja en el documento únicamente el trazo `index` (directo bajo <Document>), conservando
 * estilos, esquemas y metadatos. Así cada trazo de un archivo con varios se exporta solo.
 */
function isolateTrace(doc: Document, index: number) {
  const lines = linePlacemarks(doc);
  const target = lines[index];
  if (!target) throw new Error(`El archivo no tiene el trazo #${index + 1}`);
  if (lines.length === 1 && folderPathOf(target).length === 0) return;
  const document = byLocal(doc, 'Document')[0] ?? doc.documentElement;
  // estilos definidos dentro de carpetas: se suben al documento para no romper styleUrl
  for (const s of [...byLocal(document, 'Style'), ...byLocal(document, 'StyleMap')]) {
    if (s.parentElement !== document && s.parentElement?.localName !== 'Placemark' && s.parentElement?.localName !== 'Pair') {
      document.insertBefore(s, document.firstElementChild?.nextSibling ?? null);
    }
  }
  for (const child of Array.from(document.children)) {
    if (FEATURES.has(child.localName)) document.removeChild(child);
  }
  document.appendChild(doc.createTextNode('\n\t'));
  document.appendChild(target);
  document.appendChild(doc.createTextNode('\n'));
}

/** Lee un .kml o .kmz y devuelve el texto KML. */
export async function readKmlText(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith('.kmz')) return file.text();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.kml'));
  const main = entries.find((f) => f.name.toLowerCase() === 'doc.kml') ?? entries[0];
  if (!main) throw new Error('El KMZ no contiene ningún .kml');
  return main.async('string');
}

export interface ExportOptions {
  reversed: boolean;
  /** Trazo del archivo a exportar (si trae varios). */
  index?: number;
  /** Geometría nueva (ya orientada). Si se da, reemplaza al trazo original e ignora `reversed`. */
  coords?: Coord[];
  /** Nombre nuevo del trazo y del documento (p. ej. para una ruta alterna). */
  name?: string;
  startDescription?: string;
  endDescription?: string;
  /**
   * Colonias por las que pasa (ver colonias): se escribe en ExtendedData como COLONIAS,
   * reemplazando el valor anterior; vacío lo quita. Sin definir, se deja lo que traiga el archivo.
   */
  colonias?: string;
}

const fmt = (n: number) => String(Number(n.toFixed(7)));

const STYLE_START = 'dir-tool-inicio';
const STYLE_END = 'dir-tool-final';

/**
 * Genera el KML final a partir del original: conserva estilos, ExtendedData y
 * todo lo demás; sólo (1) invierte el trazo si se pidió y (2) reemplaza los
 * marcadores INICIO/FINAL por unos nuevos sobre los extremos del trazo.
 */
export function buildKml(original: string, opts: ExportOptions): string {
  const doc = parseXml(original);
  const ns = doc.documentElement.namespaceURI ?? 'http://www.opengis.net/kml/2.2';
  const el = (tag: string, text?: string) => {
    const e = doc.createElementNS(ns, tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };

  isolateTrace(doc, opts.index ?? 0);
  const line = findLinePlacemark(doc);
  if (!line) throw new Error('No se encontró un LineString en el KML.');

  let oriented: string[][];
  if (opts.coords) {
    // Geometría editada: todo va en el primer LineString y se quitan los demás
    oriented = [opts.coords.map(([lng, lat]) => `${fmt(lng)},${fmt(lat)},0`)];
    for (const c of line.coordEls.slice(1)) {
      const ls = c.parentNode as Element;
      ls.parentNode?.removeChild(ls);
    }
    line.coordEls.length = 1;
  } else {
    const parts = line.coordEls.map((c) => splitTuples(c.textContent ?? ''));
    oriented = opts.reversed ? parts.map((_, i) => [...parts[parts.length - 1 - i]].reverse()) : parts;
  }
  line.coordEls.forEach((c, i) => {
    c.textContent = '\n' + oriented[i].join(' ') + '\n';
  });

  if (opts.name) {
    const setName = (owner: Element) => {
      let n = Array.from(owner.children).find((c) => c.localName === 'name');
      if (!n) owner.insertBefore((n = el('name')), owner.firstChild);
      n.textContent = opts.name!;
    };
    setName(line.pm);
    const document = byLocal(doc, 'Document')[0];
    if (document) setName(document);
  }

  if (opts.colonias !== undefined) setData(line.pm, 'COLONIAS', opts.colonias, el);

  for (const m of markerPlacemarks(doc)) m.el.parentNode?.removeChild(m.el);

  const flat = oriented.flat();
  const start = tupleToCoord(flat[0]);
  const end = tupleToCoord(flat[flat.length - 1]);

  // Estilos de los pines (una sola vez, dentro del <Document>)
  const document = byLocal(doc, 'Document')[0] ?? doc.documentElement;
  for (const [id, color, icon] of [
    [STYLE_START, 'ff00ff00', 'http://maps.google.com/mapfiles/kml/paddle/go.png'],
    [STYLE_END, 'ff0000ff', 'http://maps.google.com/mapfiles/kml/paddle/stop.png'],
  ] as const) {
    if (byLocal(doc, 'Style').some((s) => s.getAttribute('id') === id)) continue;
    const style = el('Style');
    style.setAttribute('id', id);
    const iconStyle = el('IconStyle');
    iconStyle.append(el('color', color));
    const iconEl = el('Icon');
    iconEl.append(el('href', icon));
    iconStyle.append(iconEl);
    style.append(iconStyle);
    const anchor = Array.from(document.children).find((c) => c.localName === 'Placemark' || c.localName === 'Folder');
    document.insertBefore(style, anchor ?? null);
    document.insertBefore(doc.createTextNode('\n\t'), anchor ?? null);
  }

  const pin = (name: string, styleId: string, c: Coord, description?: string) => {
    const pm = el('Placemark');
    pm.append(el('name', name));
    if (description) pm.append(el('description', description));
    pm.append(el('styleUrl', '#' + styleId));
    const pt = el('Point');
    pt.append(el('coordinates', `${c[0]},${c[1]},0`));
    pm.append(pt);
    return pm;
  };

  // Mismo orden que los KML hechos en Google Earth: trazo, INICIO, FINAL
  const container = line.pm.parentNode!;
  const after = line.pm.nextSibling;
  for (const node of [
    doc.createTextNode('\n\t'),
    pin('INICIO', STYLE_START, start, opts.startDescription),
    doc.createTextNode('\n\t'),
    pin('FINAL', STYLE_END, end, opts.endDescription),
  ]) {
    container.insertBefore(node, after);
  }

  return serialize(doc);
}

/** Pone (o quita, si `value` está vacío) un <Data name> en el ExtendedData del Placemark. */
function setData(pm: Element, name: string, value: string, el: (tag: string, text?: string) => Element) {
  let ext = childByLocal(pm, 'ExtendedData');
  for (const d of ext ? Array.from(ext.children).filter((c) => c.localName === 'Data' && c.getAttribute('name') === name) : []) ext!.removeChild(d);
  if (!value) return;
  if (!ext) {
    // en el orden del esquema KML, ExtendedData va antes de la geometría
    ext = el('ExtendedData');
    const geometry = Array.from(pm.children).find((c) => ['LineString', 'MultiGeometry', 'Point', 'Polygon'].includes(c.localName));
    pm.insertBefore(ext, geometry ?? null);
  }
  const data = el('Data');
  data.setAttribute('name', name);
  data.append(el('value', value));
  // los <Data> van antes de los <SchemaData>
  ext.insertBefore(data, Array.from(ext.children).find((c) => c.localName === 'SchemaData') ?? null);
}

function serialize(doc: Document): string {
  let xml = new XMLSerializer().serializeToString(doc);
  // Google Earth declara xmlns:kml con el mismo URI que el namespace por defecto y
  // XMLSerializer puede escribir la raíz como <kml:kml>; se deja como en el original.
  const rootTag = doc.documentElement.tagName;
  xml = xml.replace(new RegExp(`<[\\w.-]+:${rootTag}(?=[\\s>])`), `<${rootTag}`).replace(new RegExp(`</[\\w.-]+:${rootTag}>\\s*$`), `</${rootTag}>\n`);
  if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  return xml.replace(/^(<\?xml[^>]*\?>)(?=<)/, '$1\n');
}

/**
 * Un solo KML con carpetas para revisar todo en Google Earth:
 * <Folder carpeta> → <Folder trazo> → trazo + INICIO + FINAL.
 * `entries` son KML ya procesados (un trazo cada uno, como los genera buildKml).
 */
export function buildFolderedKml(title: string, entries: { folder: string; name: string; kml: string }[]): string {
  const doc = parseXml('<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>');
  const ns = doc.documentElement.namespaceURI!;
  const root = byLocal(doc, 'Document')[0];
  const el = (tag: string, text?: string) => {
    const e = doc.createElementNS(ns, tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  root.append(el('name', title));

  const styleIds = new Set<string>();
  const folders = new Map<string, Element>();
  const folderFor = (path: string): Element => {
    if (!path) return root;
    const existing = folders.get(path);
    if (existing) return existing;
    const parent = folderFor(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const f = el('Folder');
    f.append(el('name', path.split('/').pop()!));
    parent.append(f);
    folders.set(path, f);
    return f;
  };

  for (const entry of entries) {
    const src = parseXml(entry.kml);
    for (const s of [...byLocal(src, 'Style'), ...byLocal(src, 'StyleMap')]) {
      const id = s.getAttribute('id');
      if (!id || styleIds.has(id) || s.parentElement?.localName === 'Placemark') continue;
      styleIds.add(id);
      root.insertBefore(doc.importNode(s, true), root.children[1] ?? null);
    }
    const f = el('Folder');
    f.append(el('name', entry.name));
    for (const pm of byLocal(src, 'Placemark')) f.append(doc.importNode(pm, true));
    folderFor(entry.folder).append(f);
  }
  return serialize(doc);
}
