import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { samePlace } from '../../domain/places';
import type { Report } from '../report';
import { Workspace } from '../../io/store';
import type { LoteInfo } from '../../config';
import { ActionError } from '../../errors';
import type { ReviewItem, TraceRow } from '@protocol';
import { type Manifest, type ReviewStore, load, persist } from './store';

// Duplas y carpetas de salida: cómo se numeran, a qué carpeta va cada archivo y cómo se renumeran.

/** Número de dupla del pipeline (`duplaN` sólo viene cuando el pipeline escribió el archivo). */
const duplaOf = (row: TraceRow): number | undefined => row.dupla ?? row.duplaN;

/** Carpeta numérica de dupla de un archivo `<zona>/<ruta>/<n>/<archivo>.kml`. */
const folderNumber = (rel: string | null | undefined): number | undefined => {
  const parts = rel?.split('/') ?? [];
  return parts.length >= 2 && /^\d+$/.test(parts[parts.length - 2]) ? Number(parts[parts.length - 2]) : undefined;
};

/**
 * Dupla con la que se agrupó un trazo resuelto a mano. Las resoluciones anteriores a este registro
 * se guardaban en la carpeta con el número de esa dupla, así que de ahí se toma.
 */
const mergedDupla = (row: TraceRow): number | undefined =>
  row.resolucionManual?.estado === 'generado' && row.resolucionManual.grupoMapa === undefined
    ? (row.resolucionManual.dupla ?? folderNumber(row.archivo))
    : undefined;

type DuplaKey = number | string;

/** Dupla de un trazo para numerar carpetas: la del pipeline o, en un mapa evaluado a mano, `<mapa>#<dupla elegida>`. */
export const duplaKey = (row: TraceRow): DuplaKey | undefined =>
  row.resolucionManual?.grupoMapa !== undefined ? `${row.mapa}#${row.resolucionManual.grupoMapa}` : duplaOf(row);

/**
 * Carpeta (1, 2, 3…) de cada dupla de una ruta. Siguen el orden de los mapas, pero sólo cuentan las
 * duplas vivas (con algún trazo generado o pendiente) y las que se juntaron al resolver cuentan como
 * una: si el mapa 1 traía dos duplas y se dejó una sola, el mapa 2 va a la carpeta 2. Las duplas de
 * un mapa evaluado a mano ocupan el lugar de ese mapa.
 * @param merges duplas que además se juntan (las de la resolución en curso).
 */
export function duplaFolders(rows: TraceRow[], ruta: string, merges: [number, number][] = []): Map<DuplaKey, number> {
  const live = rows.filter(
    (r) =>
      r.ruta === ruta &&
      r.estado !== 'NO_SE_GENERA' &&
      (r.resolucionManual?.grupoMapa !== undefined || (r.rol === 'principal' && !r.duplicadoDe && duplaOf(r) !== undefined)),
  );
  // posición de cada dupla: el orden de su mapa y, dentro de él, su número (las del pipeline ya
  // vienen numeradas en el orden de los mapas)
  const ordenOf = new Map(rows.map((r) => [r.mapa, r.orden]));
  const pos = new Map<DuplaKey, [number, number]>();
  for (const r of live) {
    const g = r.resolucionManual?.grupoMapa;
    pos.set(duplaKey(r)!, g !== undefined ? [r.orden, g] : [ordenOf.get(r.mapaAsignado) ?? r.orden, duplaOf(r)!]);
  }
  const before = (a: DuplaKey, b: DuplaKey) => {
    const [x, y] = [pos.get(a)!, pos.get(b)!];
    return x[0] - y[0] || x[1] - y[1];
  };
  // cada conjunto queda representado por su dupla más temprana
  const parent = new Map<DuplaKey, DuplaKey>();
  const find = (n: DuplaKey): DuplaKey => {
    const p = parent.get(n)!;
    if (p === n) return n;
    const root = find(p);
    parent.set(n, root);
    return root;
  };
  const union = (a: DuplaKey, b: DuplaKey) => {
    const [x, y] = [find(a), find(b)];
    if (x === y) return;
    if (before(x, y) < 0) parent.set(y, x);
    else parent.set(x, y);
  };
  for (const k of pos.keys()) parent.set(k, k);
  const pairs = [...live.map((r): [DuplaKey, number | undefined] => [duplaKey(r)!, mergedDupla(r)]), ...merges];
  for (const [a, b] of pairs) if (b !== undefined && parent.has(a) && parent.has(b)) union(a, b);
  const roots = [...new Set([...parent.keys()].map(find))].sort(before);
  const rank = new Map(roots.map((root, i) => [root, i + 1]));
  return new Map([...parent.keys()].map((n) => [n, rank.get(find(n))!]));
}

/** Carpeta de salida de un trazo que se resuelve: la de su dupla, sin huecos (ver `duplaFolders`). */
export function outputGroup(report: Report, traza: TraceRow, alias: Record<string, string>): string {
  const own = duplaOf(traza);
  const raw = groupDupla(report, traza, alias);
  if (own === undefined || raw === undefined) return `mapa-${traza.orden}`;
  return String(duplaFolders(report.trazos, traza.ruta, [[own, raw]]).get(own) ?? own);
}

/**
 * Dupla del pipeline con la que se agrupa un trazo al resolverlo: la suya o, si es un tramo suelto
 * que continúa a otros del mismo mapa (A→B, B→C), la menor de esa cadena.
 */
export function groupDupla(report: Report, traza: TraceRow, alias: Record<string, string>): number | undefined {
  const own = duplaOf(traza);
  if (own === undefined) return undefined;

  const rows = report.trazos.filter(
    (row) =>
      row.ruta === traza.ruta &&
      row.mapaAsignado === traza.mapaAsignado &&
      row.rol === 'principal' &&
      !row.duplicadoDe &&
      row.estado !== 'NO_SE_GENERA' &&
      duplaOf(row) !== undefined,
  );
  const groups = new Map<number, TraceRow[]>();
  for (const row of rows) groups.set(duplaOf(row)!, [...(groups.get(duplaOf(row)!) ?? []), row]);

  const singles = [...groups.entries()].filter(([, members]) => members.length === 1);
  const connections = new Map(singles.map(([n]) => [n, { neighbors: new Set<number>(), endpoints: [0, 0] as [number, number] }]));
  for (let i = 0; i < singles.length; i++) {
    for (let j = i + 1; j < singles.length; j++) {
      const [aN, [a]] = singles[i];
      const [bN, [b]] = singles[j];
      if (a.variante !== b.variante) continue;
      const connect = (fromN: number, fromEnd: 0 | 1, toN: number, toEnd: 0 | 1) => {
        connections.get(fromN)!.neighbors.add(toN);
        connections.get(toN)!.neighbors.add(fromN);
        connections.get(fromN)!.endpoints[fromEnd]++;
        connections.get(toN)!.endpoints[toEnd]++;
      };
      if (a.destino && b.origen && samePlace(a.destino, b.origen, alias)) connect(aN, 1, bN, 0);
      if (b.destino && a.origen && samePlace(b.destino, a.origen, alias)) connect(bN, 1, aN, 0);
    }
  }

  const visited = new Set<number>();
  for (const [start] of singles) {
    if (visited.has(start) || !connections.get(start)!.neighbors.size) continue;
    const component: number[] = [];
    const pending = [start];
    while (pending.length) {
      const n = pending.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      component.push(n);
      pending.push(...connections.get(n)!.neighbors);
    }
    if (component.some((n) => connections.get(n)!.endpoints.some((count) => count > 1))) continue;
    if (component.some((n) => groups.get(n)!.some((row) => row.id === traza.id))) {
      return Math.min(...component);
    }
  }

  return own;
}

/**
 * Mueve los KML generados de una ruta a la carpeta de dupla que les toca según `duplaFolders`
 * (sin huecos) y actualiza manifiesto, reporte y resoluciones. Valida todo antes de mover.
 */
/** Dónde debe quedar el archivo generado de un trazo según las carpetas de dupla (sólo carpetas numéricas). */
export function targetOf(row: TraceRow, folders: Map<DuplaKey, number>): string | undefined {
  const key = duplaKey(row);
  const n = key === undefined ? undefined : folders.get(key);
  const parts = row.archivo?.split('/') ?? [];
  // sólo carpetas de dupla numéricas (<zona>/<ruta>/<n>/<archivo>.kml)
  if (n === undefined || parts.length < 2 || !/^\d+$/.test(parts[parts.length - 2])) return undefined;
  return [...parts.slice(0, -2), String(n), parts[parts.length - 1]].join('/');
}

export function renumberRoute(ws: Workspace, manifest: Manifest, reviews: ReviewStore, report: Report, ruta: string): { de: string; a: string }[] {
  // las resoluciones antiguas se agrupaban por el número de su carpeta: se registra antes de moverlas
  for (const row of report.trazos) {
    const manual = row.resolucionManual;
    if (row.ruta !== ruta || manual?.estado !== 'generado' || manual.dupla !== undefined || manual.grupoMapa !== undefined) continue;
    const dupla = folderNumber(row.archivo);
    if (dupla === undefined) continue;
    manual.dupla = dupla;
    if (reviews.decisiones[row.id]) reviews.decisiones[row.id].dupla = dupla;
  }
  const folders = duplaFolders(report.trazos, ruta);
  const moves: { row: TraceRow; from: string; to: string }[] = [];
  for (const row of report.trazos) {
    if (row.ruta !== ruta || row.estado !== 'GENERADO' || !row.archivo) continue;
    const to = targetOf(row, folders);
    if (to && to !== row.archivo) moves.push({ row, from: row.archivo, to });
  }
  if (!moves.length) return [];

  const vacated = new Set(moves.map((m) => m.from.toUpperCase()));
  const targets = new Set<string>();
  for (const m of moves) {
    if (!ws.exists('resultados', ...m.from.split('/'))) throw new ActionError(`No se encuentra resultados/${m.from} para moverlo a su carpeta de dupla`, 409);
    if (targets.has(m.to.toUpperCase())) throw new ActionError(`Dos trazos irían a resultados/${m.to}; renombra uno antes de continuar`, 409);
    targets.add(m.to.toUpperCase());
    if (ws.exists('resultados', ...m.to.split('/')) && !vacated.has(m.to.toUpperCase())) {
      throw new ActionError(`No se puede mover resultados/${m.from} a resultados/${m.to} porque ya existe`, 409);
    }
  }

  // en dos pasos (vía una carpeta temporal) por si dos carpetas intercambian número
  const temp = `_RENUMERANDO/${Date.now()}`;
  moves.forEach((m, i) => {
    const staged = ws.path('resultados', ...temp.split('/'), `${i}.kml`);
    mkdirSync(dirname(staged), { recursive: true });
    renameSync(ws.path('resultados', ...m.from.split('/')), staged);
  });
  moves.forEach((m, i) => {
    const target = ws.path('resultados', ...m.to.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    renameSync(ws.path('resultados', ...temp.split('/'), `${i}.kml`), target);
    if (manifest.archivos[m.from]) {
      manifest.archivos[m.to] = manifest.archivos[m.from];
      delete manifest.archivos[m.from];
    }
    m.row.archivo = m.to;
    const decision = reviews.decisiones[m.row.id];
    if (decision?.archivoDestino === m.from) decision.archivoDestino = m.to;
  });
  removeEmptyDirs(ws.path('resultados', ...temp.split('/')), ws.path('resultados'));
  for (const m of moves) removeEmptyDirs(dirname(ws.path('resultados', ...m.from.split('/'))), ws.path('resultados'));
  return moves.map((m) => ({ de: m.from, a: m.to }));
}

/** Borra `dir` y sus padres mientras estén vacíos, sin pasar de `stop`. */
export function removeEmptyDirs(dir: string, stop: string) {
  for (let d = dir; d.length > stop.length && d.startsWith(stop); d = dirname(d)) {
    if (!existsSync(d) || readdirSync(d).length) return;
    rmdirSync(d);
  }
}

/** Reacomoda las carpetas de dupla de las rutas indicadas (ya con el candado tomado). */
function renumberLocked(lote: LoteInfo, rutas: Iterable<string>): { de: string; a: string }[] {
  const { ws, manifest, report, reviews } = load(lote);
  if (!report) return [];
  const moved = [...new Set(rutas)].flatMap((ruta) => renumberRoute(ws, manifest, reviews, report, ruta));
  if (moved.length) persist(ws, manifest, reviews, report);
  return moved;
}

/** Reacomoda las carpetas de dupla de todo el lote (o de las rutas indicadas). */
export function renumberDuplas(lote: LoteInfo, rutas?: string[]): { de: string; a: string }[] {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock('reacomodo de carpetas de dupla');
  try {
    const report = load(lote).report;
    return renumberLocked(lote, rutas ?? [...new Set((report?.trazos ?? []).map((t) => t.ruta))]);
  } finally {
    release();
  }
}

/**
 * Ejecuta `fn` (con el candado ya tomado) dejando sin huecos las carpetas de dupla de las rutas
 * que toca: antes, por si quedaron de una versión anterior, y después, porque descartar o juntar
 * duplas recorre las carpetas de los mapas siguientes.
 */
export function withRenumber(lote: LoteInfo, rutas: string[], fn: () => ReviewItem[]): ReviewItem[] {
  renumberLocked(lote, rutas);
  const items = fn();
  const moved = new Map(renumberLocked(lote, [...rutas, ...items.map((item) => item.traza.ruta)]).map((m) => [m.de, m.a]));
  for (const item of items) {
    const rel = item.archivo?.replace(/^resultados\//, '');
    if (rel && moved.has(rel)) item.archivo = `resultados/${moved.get(rel)}`;
    if (item.traza.archivo && moved.has(item.traza.archivo)) item.traza.archivo = moved.get(item.traza.archivo)!;
    if (item.resolucion && moved.has(item.resolucion.archivoDestino)) item.resolucion.archivoDestino = moved.get(item.resolucion.archivoDestino)!;
  }
  return items;
}

export function safeOutputName(value: string) {
  const name = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex -- quita a propósito los caracteres de control
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  if (!name || name === '.' || name === '..') throw new ActionError('El nombre de salida no es válido', 400);
  return name;
}
