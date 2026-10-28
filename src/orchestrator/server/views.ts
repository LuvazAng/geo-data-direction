import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Report } from '../pipeline/report';
import { type TraceRow, type FilesSnapshot, type FileView, type FolderView, type Job, type MapView, type RouteStatus, type RouteUnit, ACTIVE } from '@protocol';
import type { SourceScan } from '../io/source';
import { Workspace, type BatchState, type MapState } from '../io/store';
import type { LoteInfo } from '../config';
import { folderOf } from '../domain/naming';

// Vistas de sólo lectura sobre lo que el orquestador dejó en el lote. El estado de cada archivo
// sale de estado.json y del manifiesto de resultados (huella SHA-256), no de que el archivo
// aparezca en una carpeta.

interface Manifest {
  archivos: Record<
    string,
    { sha256: string; tipo: 'resultado' | 'revision'; traza: string; mapa: string; fuente: string; original: string; generadoEn: string }
  >;
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function ws(lote: LoteInfo) {
  return new Workspace(lote.config.dirs.trabajo, lote.config.lote);
}

export function loteData(lote: LoteInfo) {
  const w = ws(lote);
  return {
    w,
    scan: w.readJson<SourceScan | null>(['fuente.json'], null),
    state: w.readJson<BatchState | null>(['estado.json'], null),
    manifest: w.readJson<Manifest>(['resultados', 'manifiesto.json'], { archivos: {} }),
  };
}

function routeStatus(maps: (MapState | undefined)[]): RouteStatus {
  const states = maps.map((m) => m?.estado ?? 'PENDIENTE');
  if (states.every((s) => s === 'PENDIENTE')) return 'sin-procesar';
  if (states.some((s) => !['GENERADO', 'REQUIERE_REVISION', 'DESCARTADO', 'ERROR'].includes(s))) return 'incompleta';
  if (states.some((s) => s === 'ERROR')) return 'con-errores';
  if (states.some((s) => s === 'REQUIERE_REVISION')) return 'con-revision';
  return 'procesada';
}

/** Rutas (subpáginas) conocidas de un lote, con su estado y la ejecución que tengan en curso. */
export function routeUnits(lote: LoteInfo, jobs: Job[]): RouteUnit[] {
  const { scan, state } = loteData(lote);
  if (!scan) return [];
  return scan.pages.map((p) => {
    const maps = scan.maps.filter((m) => m.pageSlug === p.slug);
    const ms = maps.map((m) => state?.mapas[m.id]);
    const conteo: Record<string, number> = {};
    for (const m of ms) conteo[m?.estado ?? 'PENDIENTE'] = (conteo[m?.estado ?? 'PENDIENTE'] ?? 0) + 1;
    const mine = jobs.filter((j) => j.lote === lote.lote && j.unidad.tipo === 'ruta' && j.unidad.slug === p.slug);
    const activo = mine.find((j) => j.estado === 'PENDIENTE' || ACTIVE.includes(j.estado));
    const ultimo = mine.filter((j) => j.finalizadoEn).sort((a, b) => b.finalizadoEn!.localeCompare(a.finalizadoEn!))[0];
    return {
      lote: lote.lote,
      slug: p.slug,
      titulo: p.title || p.slug,
      mapas: maps.length,
      estado: p.status === 'error' && maps.length === 0 ? 'con-errores' : routeStatus(ms),
      conteo,
      ...(activo && { jobActivo: activo.id }),
      ...(ultimo && { ultimoJob: ultimo.id }),
    };
  });
}

const ORIGINAL_STATE: Record<string, FileView['estado']> = {
  PENDIENTE: 'pendiente',
  DESCARGANDO: 'en-proceso',
  DESCARGADO: 'descargado',
  ANALIZADO: 'analizado',
  CLASIFICADO: 'analizado',
  GENERADO: 'analizado',
  REQUIERE_REVISION: 'analizado',
  DESCARTADO: 'analizado',
  ERROR: 'error',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '_obsoletos') walk(p, out);
    } else if (!name.endsWith('.tmp')) out.push(p);
  }
  return out;
}

/** Carpetas y archivos de un lote (o de una ruta). */
export function filesSnapshot(lote: LoteInfo, ruta?: string): FilesSnapshot {
  const { w, scan, state, manifest } = loteData(lote);
  const rel = (p: string) => relative(w.root, p).split(sep).join('/');
  const byMap = new Map<string, [string, Manifest['archivos'][string]][]>();
  for (const [r, m] of Object.entries(manifest.archivos)) (byMap.get(m.mapa) ?? byMap.set(m.mapa, []).get(m.mapa)!).push([r, m]);

  const output = (r: string, m: Manifest['archivos'][string]): FileView => {
    const p = w.path('resultados', ...r.split('/'));
    const base: FileView = {
      rel: `resultados/${r}`,
      nombre: r.split('/').pop()!,
      tipo: m.tipo,
      estado: m.tipo === 'revision' ? 'revision' : 'generado',
      traza: m.traza,
    };
    if (!existsSync(p)) return { ...base, estado: 'falta', detalle: 'está en el manifiesto pero no en disco' };
    const bytes = statSync(p).size;
    if (sha(p) !== m.sha256) return { ...base, bytes, estado: 'modificado', detalle: 'cambió después de generarse' };
    return { ...base, bytes };
  };

  const rutas: FolderView[] = (scan?.pages ?? [])
    .filter((p) => !ruta || p.slug === ruta)
    .map((p) => ({
      lote: lote.lote,
      slug: p.slug,
      titulo: p.title || p.slug,
      carpeta: folderOf(p.slug),
      mapas: scan!.maps
        .filter((m) => m.pageSlug === p.slug)
        .map((m): MapView => {
          const s = state?.mapas[m.id];
          const orig = s?.archivo ? w.path('originales', s.archivo) : null;
          return {
            id: m.id,
            orden: m.order,
            titulo: m.title,
            estado: s?.estado ?? 'PENDIENTE',
            ...(s?.error && { error: s.error }),
            original: orig
              ? existsSync(orig)
                ? {
                    rel: `originales/${s!.archivo}`,
                    nombre: s!.nombreServidor ?? s!.archivo!,
                    tipo: 'original',
                    estado: ORIGINAL_STATE[s!.estado] ?? 'descargado',
                    bytes: statSync(orig).size,
                  }
                : { rel: `originales/${s!.archivo}`, nombre: s!.archivo!, tipo: 'original', estado: 'falta' }
              : null,
            salidas: (byMap.get(m.id) ?? []).sort(([a], [b]) => a.localeCompare(b)).map(([r, man]) => output(r, man)),
          };
        }),
    }));

  const known = new Set(Object.keys(manifest.archivos).map((r) => `resultados/${r}`));
  const noRegistrados = ruta
    ? []
    : walk(w.path('resultados'))
        .map(rel)
        .filter((r) => r !== 'resultados/manifiesto.json' && !known.has(r));
  return { lote: lote.lote, raiz: w.root, rutas, noRegistrados };
}

/** Sólo se exponen originales y resultados del lote (nunca otra ruta del servidor). */
export function checkRel(rel: unknown): string {
  if (
    typeof rel !== 'string' ||
    rel.length > 400 ||
    !/^(originales|resultados)\/[^\0\\:*?"<>|]+$/.test(rel) ||
    rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s.trim() !== s)
  ) {
    throw new BadPath('Ruta de archivo no permitida');
  }
  return rel;
}

export class BadPath extends Error {}

export function fileDetail(lote: LoteInfo, relPath: string) {
  const r = checkRel(relPath);
  const { w, state, manifest } = loteData(lote);
  const p = w.path(...r.split('/'));
  if (!existsSync(p)) throw new BadPath('El archivo no existe');
  const st = statSync(p);
  const inner = r.startsWith('resultados/') ? r.slice('resultados/'.length) : null;
  const man = inner ? manifest.archivos[inner] : undefined;
  const mapa = r.startsWith('originales/')
    ? Object.values(state?.mapas ?? {}).find((m) => m.archivo === r.slice('originales/'.length))
    : man
      ? state?.mapas[man.mapa]
      : undefined;
  const report = w.readJson<Report | null>(['reporte.json'], null);
  const traza: TraceRow | undefined = man ? report?.trazos.find((t) => t.id === man.traza) : undefined;
  const trazas = !man && mapa ? report?.trazos.filter((t) => t.mapa === mapa.id && t.rol === 'principal') : undefined;
  const hash = sha(p);
  return {
    lote: lote.lote,
    rel: r,
    bytes: st.size,
    modificadoEn: st.mtime.toISOString(),
    sha256: hash,
    registro: man ? { ...man, coincide: man.sha256 === hash } : null,
    mapa: mapa
      ? { id: mapa.id, titulo: mapa.title, ruta: mapa.pageSlug, estado: mapa.estado, url: mapa.downloadUrl, descargadoEn: mapa.descargadoEn, error: mapa.error }
      : null,
    traza: traza ?? null,
    trazas: trazas ?? null,
  };
}

export function fileContent(lote: LoteInfo, relPath: string): { nombre: string; contenido: Buffer } {
  const r = checkRel(relPath);
  if (!/\.(kml|kmz)$/i.test(r)) throw new BadPath('Sólo se pueden abrir archivos .kml o .kmz');
  const p = ws(lote).path(...r.split('/'));
  if (!existsSync(p)) throw new BadPath('El archivo no existe');
  if (statSync(p).size > 20 * 1024 * 1024) throw new BadPath('Archivo demasiado grande');
  return { nombre: r.split('/').pop()!, contenido: readFileSync(p) };
}
