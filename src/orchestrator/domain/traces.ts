import { parseKmlAll, type Coord, describedEnds, isCircuit, lengthKm, meters, normalize, type DescribedEnds } from '@core';

// Análisis de cada trazo (Placemark con LineString) de un archivo descargado. Un archivo
// puede traer varios: ida, regreso, "Base-Inicio de Recorrido" y ampliaciones (AMPL.).

export type TraceKind = 'itinerario' | 'ampliacion' | 'base' | 'otro';

export interface TraceInfo {
  /** `<id del mapa>#<índice>` */
  id: string;
  mapId: string;
  index: number;
  name: string;
  folderPath: string[];
  /** ExtendedData tal como viene. */
  props: Record<string, string>;
  /** ExtendedData con la codificación reparada (sólo para analizar; el archivo no se toca). */
  text: Record<string, string>;
  coords: Coord[];
  lengthM: number;
  first: Coord;
  last: Coord;
  circuit: boolean;
  bbox: [number, number, number, number];
  kind: TraceKind;
  /** "ORIGEN-DESTINO" según DESCRIPCIO (sólo itinerarios). */
  described: DescribedEnds | null;
  /** Texto de "por dónde pasa" (X LA GAS → "LA GAS"), si lo indica el nombre o DESCRIPCIO. */
  via: string | null;
  /** Mayor distancia entre dos vértices consecutivos (m). */
  maxGapM: number;
  anomalies: string[];
}

export interface MapTraces {
  mapId: string;
  /** Nombre del <Document> del KML. */
  docName: string;
  traces: TraceInfo[];
  /** Placemarks con LineString que no se pudieron usar (menos de 2 puntos). */
  descartados: number;
  anomalies: string[];
}

// Texto CP850 leído como Windows-1252 (p. ej. "M‚xico", "L zaro C rdenas" con U+00A0).
const CP850_AS_1252: Record<string, string> = {
  ' ': 'á',
  '‚': 'é',
  '¡': 'í',
  '¢': 'ó',
  '£': 'ú',
  '¤': 'ñ',
  '¥': 'Ñ',
  µ: 'Á',
  '\u0090': 'É',
  Ö: 'Í',
  à: 'Ó',
  é: 'Ú',
  '\u0081': 'ü',
  š: 'Ü',
};
const MOJIBAKE = /[‚¢£¤¥\u0090]|[A-Za-z] [A-Za-z]/;
/** "AMPLIACIàN": la à no se usa en español; dentro de una palabra es la Ó de CP850. */
const LONE_O = /([A-Za-z])à(?=[A-Za-z])/g;

export function fixMojibake(s: string): string {
  // Sólo con señales inequívocas se traduce todo (incluida é → Ú); si no, sólo la à. Así
  // textos correctos como "JOSé MARíA" no se alteran.
  if (!MOJIBAKE.test(s)) return s.replace(LONE_O, '$1Ó');
  return s.replace(/[ ‚¡-¥µ\u0090Öàé\u0081š]/g, (c) => CP850_AS_1252[c] ?? c);
}

const VIA_RE = /\(\s*(?:X|POR|V[IÍ]A)\s+([^)]+?)\s*\)|\s(?:X|POR|V[IÍ]A)\s+([A-ZÁÉÍÓÚÑ0-9][^()-]*?)\s*$/i;

/** "N.- A-B-C" → lugares, "por dónde pasa" y si regresa al punto de partida. */
export function parsePlaces(title: string) {
  // "1.-", "3.", "5)" o "2 -" son el número del mapa; "3 DE MAYO" no
  let t = fixMojibake(title)
    .replace(/^\s*\d+\s*(?:[.)]\s*-?|-)\s*/, '')
    .trim();
  let via: string | null = null;
  const m = VIA_RE.exec(t);
  if (m) {
    via = (m[1] ?? m[2]).trim();
    t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim();
  }
  const places = t
    .split(/\s*-\s*/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}|\d/.test(p));
  const circuit = places.length >= 2 && normalize(places[0]) === normalize(places[places.length - 1]);
  return { places, via, circuit };
}

/** Lugar sin el calificador entre paréntesis: "COL. LA CRUZ (XOCHITEPEC)" → nombre + calificador. */
export function splitQualifier(place: string) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(place);
  return m ? { nombre: m[1].trim(), calificador: m[2].trim() } : { nombre: place.trim(), calificador: '' };
}

const MORELOS_BBOX = { minX: -99.6, maxX: -98.5, minY: 18.25, maxY: 19.2 };
/** Tramo recto sin vértices intermedios que vale la pena avisar (en carretera puede ser normal). */
const GAP_M = 1000;
/** Hueco entre dos LineString del mismo Placemark que se considera "segmento desconectado". */
const PART_GAP_M = 50;

function kindOf(name: string, text: Record<string, string>, described: DescribedEnds | null): TraceKind {
  const auto = normalize(text['AUTO-AMPL'] ?? '');
  const desc = normalize(text.DESCRIPCIO ?? '');
  if (auto === 'AMPLIACION' || /^AMPL\b/.test(normalize(name))) return 'ampliacion';
  // "Base-Inicio de Recorrido" es la salida de la base; "BASE FRESNAL" es el nombre de una terminal
  if (/INICIO DE RECORRIDO/.test(desc) || (text.DESCRIPCIO ?? '').split('-').map(normalize).includes('BASE')) return 'base';
  if (auto === 'ITINERARIO' || described) return 'itinerario';
  return 'otro';
}

function anomaliesOf(coords: Coord[], lengthM: number): string[] {
  const out: string[] = [];
  if (coords.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) out.push('coordenadas inválidas');
  if (coords.some(([x, y]) => x < MORELOS_BBOX.minX || x > MORELOS_BBOX.maxX || y < MORELOS_BBOX.minY || y > MORELOS_BBOX.maxY)) {
    out.push('puntos fuera de Morelos');
  }
  let repeated = 0;
  const gaps: string[] = [];
  for (let i = 1; i < coords.length; i++) {
    const d = meters(coords[i - 1], coords[i]);
    if (d < 0.5) repeated++;
    else if (d > GAP_M) gaps.push(`${Math.round(d)} m en el vértice ${i + 1}`);
  }
  if (gaps.length) out.push(`tramo recto sin vértices intermedios: ${gaps.slice(0, 3).join(', ')}${gaps.length > 3 ? '…' : ''}`);
  if (repeated) out.push(`${repeated} puntos repetidos consecutivos`);
  if (lengthM < 200) out.push(`muy corto (${Math.round(lengthM)} m)`);
  return out;
}

/** Por Placemark con LineString (mismo orden que parseKmlAll): huecos entre sus LineString. */
function partGaps(kmlText: string): number[][] {
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  const byTag = (el: Document | Element, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag));
  return byTag(doc, 'Placemark')
    .filter((pm) => byTag(pm, 'LineString').length > 0)
    .map((pm) => {
      const parts = byTag(pm, 'LineString')
        .map((ls) => (byTag(ls, 'coordinates')[0]?.textContent ?? '').trim().split(/\s+/).filter(Boolean))
        .filter((p) => p.length > 0)
        .map((p) => [p[0], p[p.length - 1]].map((t) => t.split(',').map(Number).slice(0, 2) as Coord));
      return parts.slice(1).map((p, i) => meters(parts[i][1], p[0]));
    });
}

export function analyzeKml(mapId: string, kmlText: string): MapTraces {
  const parsed = parseKmlAll(kmlText);
  const gapsByPlacemark = partGaps(kmlText);
  const declared = (kmlText.match(/<(?:\w+:)?LineString[\s>]/g) ?? []).length;
  const placemarksWithLines = parsed[0]?.count ?? 0;
  const docName = fixMojibake(/<Document[^>]*>\s*<name>([^<]*)<\/name>/.exec(kmlText)?.[1]?.trim() ?? '');

  const traces = parsed.map((p): TraceInfo => {
    const text = Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, fixMojibake(v)]));
    const coords = p.coords;
    const lengthM = lengthKm(coords) * 1000;
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const name = fixMojibake(p.name);
    const prelim = describedEnds({ DESCRIPCIO: text.DESCRIPCIO ?? '' });
    const kind = kindOf(name, text, prelim);
    const own = parsePlaces(text.DESCRIPCIO ?? '');
    const fromName = parsePlaces(name);
    return {
      id: `${mapId}#${p.index}`,
      mapId,
      index: p.index,
      name,
      folderPath: p.folderPath,
      props: p.props,
      text,
      coords,
      lengthM,
      first: coords[0],
      last: coords[coords.length - 1],
      circuit: isCircuit(coords),
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      kind,
      described: kind === 'itinerario' ? describedEnds({ DESCRIPCIO: own.places.join('-') }) : null,
      via: own.via ?? fromName.via,
      maxGapM: Math.round(coords.slice(1).reduce((m, c, i) => Math.max(m, meters(coords[i], c)), 0)),
      anomalies: [
        ...anomaliesOf(coords, lengthM),
        ...(gapsByPlacemark[p.index] ?? [])
          .filter((g) => g > PART_GAP_M)
          .map((g) => `segmento desconectado: ${(gapsByPlacemark[p.index]?.length ?? 0) + 1} partes, hueco de ${Math.round(g)} m`),
      ],
    };
  });

  const anomalies: string[] = [];
  const descartados = Math.max(0, placemarksWithLines - traces.length);
  if (descartados) anomalies.push(`${descartados} trazo(s) con menos de 2 puntos`);
  if (declared > placemarksWithLines) anomalies.push(`${declared - placemarksWithLines} LineString(s) unidos a otros en MultiGeometry`);
  return { mapId, docName, traces, descartados, anomalies };
}
