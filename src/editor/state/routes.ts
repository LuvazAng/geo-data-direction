import { buildAlternative, buildKml, markerStatus, parseKml, type Coord, type ParsedKml, type Relation } from '@core';
import { baseName, safeFileName, type SourceFile } from '../services/files';
import { baseCoords, coordsOf, type Route } from '../services/route';

// Reglas de los trazos del editor (letras, colores, nombres, historial de geometría, altas y bajas)
// como funciones puras sobre `Route`: la interfaz sólo las aplica a su estado.

export const COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Cuántas geometrías anteriores se guardan por trazo para deshacer. */
export const MAX_HISTORY = 50;

let nextId = 1;
export const newRouteId = () => String(nextId++);

/** Cambia campos de un trazo: un parche, o una función que lo calcula a partir del trazo actual. */
export type PatchRoute = (id: string, patch: Partial<Route> | ((r: Route) => Partial<Route>)) => void;

export const sameCoord = (a?: Coord, b?: Coord) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

export const letterAt = (i: number) => (i < LETTERS.length ? LETTERS[i] : LETTERS[i % LETTERS.length] + Math.floor(i / LETTERS.length));

/** Primera posición con letra libre (tras eliminar trazos, `rs.length` puede repetir una letra). */
export const freeSlot = (rs: Route[]) => {
  const used = new Set(rs.map((r) => r.letter));
  let i = 0;
  while (used.has(letterAt(i))) i++;
  return i;
};

// ------------------------------------------------------------------ carga

/** Un trazo leído de un archivo (que puede traer varios), con su longitud en km. */
export interface ParsedEntry {
  source: SourceFile;
  parsed: ParsedKml;
  len: number;
}

/** Del trazo más largo al más corto (A = el más largo); determinista. Ordena en su lugar. */
export const sortLongestFirst = (list: ParsedEntry[]) =>
  list.sort((a, b) => b.len - a.len || a.source.path.localeCompare(b.source.path) || a.parsed.index - b.parsed.index);

/**
 * Nombre de salida de cada trazo: el del archivo si trae un solo trazo; si trae varios, el del trazo
 * (si se repite, se distingue con su DESCRIPCIO o con un número).
 */
export function outputNames(list: ParsedEntry[]): string[] {
  const rawName = ({ source, parsed }: ParsedEntry) =>
    parsed.count === 1 ? baseName(source.file.name) : safeFileName(parsed.name || `${baseName(source.file.name)} ${parsed.index + 1}`);
  const repeated = (name: string) => list.filter((p) => rawName(p) === name).length > 1;
  const used = new Set<string>();
  return list.map((p) => {
    let name = rawName(p);
    const desc = Object.entries(p.parsed.props).find(([k]) => k.toUpperCase().startsWith('DESCRIP'))?.[1];
    if (repeated(name) && desc) name = safeFileName(`${name} (${desc})`);
    for (let k = 2; used.has(name); k++) name = `${rawName(p)} (${k})`;
    used.add(name);
    return name;
  });
}

/** Trazos del editor a partir de lo leído (ya ordenado). `suggestedNames`: nombres propuestos por el orquestador. */
export function buildRoutes(list: ParsedEntry[], names: string[], suggestedNames: { indice: number; nombre: string }[] = []): Route[] {
  const suggestedByIndex = new Map(suggestedNames.map((item) => [item.indice, safeFileName(item.nombre)]));
  return list.map(({ source, parsed }, i) => ({
    id: newRouteId(),
    letter: letterAt(i),
    color: COLORS[i % COLORS.length],
    source,
    parsed,
    reversed: markerStatus(parsed.coords, parsed.markers).kind === 'reversed',
    outName: suggestedByIndex.get(parsed.index) ?? names[i],
    // con varios trazos se respeta la carpeta que traen dentro del KML (como en Google Earth)
    folder: parsed.count > 1 ? parsed.folderPath.map(safeFileName).join('/') : '',
    visible: true,
  }));
}

// ------------------------------------------------------------------ geometría e historial

export const invertPatch = (r: Route): Partial<Route> => ({ reversed: !r.reversed, saved: undefined });

/** Cambia la geometría (recibida en el sentido de exportación) guardando la anterior para deshacer. */
export function geometryPatch(r: Route, coords: Coord[] | undefined): Partial<Route> {
  const base = coords && (r.reversed ? [...coords].reverse() : coords);
  return {
    edited: base,
    history: [...(r.history ?? []), baseCoords(r)].slice(-MAX_HISTORY),
    saved: undefined,
  };
}

/** Vuelve a la geometría anterior; sin historial no cambia nada. */
export function undoPatch(r: Route): Partial<Route> {
  const history = r.history ?? [];
  if (history.length === 0) return {};
  const prev = history[history.length - 1];
  return { edited: prev === r.parsed.coords ? undefined : prev, history: history.slice(0, -1), saved: undefined };
}

/** Vuelve a la geometría del archivo, guardando la actual en el historial. */
export const restorePatch = (r: Route): Partial<Route> => ({
  edited: undefined,
  history: [...(r.history ?? []), baseCoords(r)].slice(-MAX_HISTORY),
  saved: undefined,
});

// ------------------------------------------------------------------ altas y bajas

/** Un trazo que se quitó de la lista y su posición, para poder devolverlo. */
export interface RemovedRoute {
  route: Route;
  index: number;
}

export const removedFrom = (routes: Route[], ids: string[]): RemovedRoute[] =>
  routes.flatMap((route, index) => (ids.includes(route.id) ? [{ route, index }] : []));

/** Devuelve los trazos quitados a su posición (o al final, si la lista quedó más corta). Sin efecto si ya volvieron. */
export function restoreRoutes(rs: Route[], removed: RemovedRoute[], ids: string[]): Route[] {
  if (rs.some((r) => ids.includes(r.id))) return rs;
  const out = [...rs];
  // derivedFor se reinicia por si una dirección o consulta quedó a medias mientras no estaba
  for (const { route, index } of removed) out.splice(Math.min(index, out.length), 0, { ...route, derivedFor: undefined });
  return out;
}

/** Un trazo nuevo al que todavía le falta el id, la letra y el color (los da `appendRoute`). */
export type RouteDraft = Omit<Route, 'id' | 'letter' | 'color'>;

/**
 * Ruta alterna: la principal hasta donde sale el tramo, el tramo, y la principal desde donde se
 * reincorpora. Parte del KML de la principal (conserva su estilo y sus datos: RUTA, ZONA, FOLIO…).
 * Lanza si el tramo no se puede unir.
 */
export function alternativeDraft(main: Route, short: Route, rel: Relation): RouteDraft {
  const coords = buildAlternative(coordsOf(main), coordsOf(short), rel);
  const name = safeFileName(`${main.outName} ALT ${short.outName.replace(/^AMPL\.?\s*/i, '')}`);
  const content = buildKml(main.parsed.text, { reversed: false, index: main.parsed.index, coords, name });
  const basePath = main.source.basePath ?? main.source.path.replace(/\/?[^/]*$/, '');
  return {
    source: {
      file: new File([content], `${name}.kml`),
      path: [basePath, main.folder, `${name}.kml`].filter(Boolean).join('/'),
      dir: main.source.baseDir ?? main.source.dir,
      baseDir: main.source.baseDir ?? main.source.dir,
      basePath,
      isNew: true,
    },
    parsed: parseKml(content),
    reversed: false,
    outName: name,
    folder: main.folder,
    visible: true,
    alt: { mainId: main.id, shortId: short.id },
  };
}

/** Agrega el trazo al final con la primera letra y el primer color libres de la lista actual. */
export function appendRoute(rs: Route[], draft: RouteDraft, id: string): Route[] {
  const slot = freeSlot(rs);
  return [...rs, { ...draft, id, letter: letterAt(slot), color: COLORS[slot % COLORS.length] }];
}
