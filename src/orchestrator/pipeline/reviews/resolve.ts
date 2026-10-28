import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildKml,
  parseKmlAll,
  type Coord,
  coloniasAlong,
  coloniasKml,
  type ColoniaIndex,
  buildAlternative,
  canBuildAlternative,
  RELATION_TEXT,
  relate,
} from '@core';
import { coloniaIndexFor } from '../../io/colonias';
import type { Report } from '../report';
import { Workspace, sha256 } from '../../io/store';
import type { LoteInfo } from '../../config';
import { ActionError } from '../../errors';
import type { ReviewAction, ReviewDirection, ReviewItem, ReviewKind, ReviewManifestEntry, ReviewResolution, TraceRow } from '@protocol';
import { groupDupla, outputGroup, removeEmptyDirs, safeOutputName, withRenumber } from './duplas';
import { previewFor } from './snapshot';
import { updateMapStates } from './status';
import { load, persist } from './store';

// Resolver los conflictos de un mapa: generar un KML por trazo, descartar o deshacer.

export function buildResolvedKml(
  traza: TraceRow,
  decision: ReviewResolution,
  original: string,
  principalOriginal?: string,
  principal?: TraceRow,
  colonias?: ColoniaIndex,
): string {
  if (!decision.tipo || !decision.nombre) throw new Error('La resolución no tiene tipo ni nombre de archivo');
  const source = parseKmlAll(original).find((p) => p.index === traza.indice);
  if (!source) throw new Error(`No se encontró el trazo #${traza.indice + 1} en el original`);
  const common = { index: traza.indice, name: decision.nombre, startDescription: decision.origen, endDescription: decision.destino };
  const coloniasDe = (coords: Coord[]) => colonias && coloniasKml(coloniasAlong(coords, colonias));

  if (decision.tipo === 'propia') {
    if (!decision.origen?.trim() || !decision.destino?.trim() || !decision.sentido) throw new Error('La ruta propia requiere origen, destino y sentido');
    const reversed = decision.sentido === 'inverso';
    return buildKml(original, { ...common, reversed, colonias: coloniasDe(reversed ? [...source.coords].reverse() : source.coords) });
  }

  if (!principal || !principalOriginal) throw new Error('El recorrido principal elegido no está disponible');
  const main = parseKmlAll(principalOriginal).find((p) => p.index === principal.indice);
  if (!main) throw new Error(`No se encontró el trazo principal #${principal.indice + 1}`);
  const relation = relate(source.coords, main.coords);
  if (!canBuildAlternative(relation)) throw new Error(`No se puede unir este trazo con el principal: ${RELATION_TEXT[relation.kind]}`);
  const coords = buildAlternative(main.coords, source.coords, relation);
  return buildKml(original, {
    ...common,
    coords,
    reversed: false,
    colonias: coloniasDe(coords),
    startDescription: decision.origen ?? principal.origen ?? 'Inicio de la ruta principal',
    endDescription: decision.destino ?? principal.destino ?? 'Fin de la ruta principal',
  });
}

export interface ResolveReviewInput {
  traza: string;
  accion: ReviewAction;
  tipo?: ReviewKind;
  nombre?: string;
  nota?: string;
  origen?: string;
  destino?: string;
  sentido?: ReviewDirection;
  relacionPrincipal?: string;
  contenidoKml?: string;
}

function resolveReviewLocked(lote: LoteInfo, input: ResolveReviewInput): ReviewItem {
  if (!['generar', 'descartar', 'deshacer'].includes(input.accion)) throw new ActionError('Acción de revisión no válida', 400);
  const { ws, manifest, report, reviews, state } = load(lote);
  if (!report) throw new ActionError('El lote todavía no tiene reporte para revisar', 404);
  const traza = report.trazos.find((t) => t.id === input.traza);
  if (!traza) throw new ActionError('El trazo ya no aparece en el reporte actual', 404);
  const current = reviews.decisiones[traza.id];

  if (input.accion === 'deshacer') {
    if (!current) throw new ActionError('Este trazo no tiene una resolución que deshacer', 409);
    const archiveGenerated = () => {
      if (current.estado !== 'generado') return;
      const generated = ws.path('resultados', ...current.archivoDestino.split('/'));
      if (existsSync(generated)) {
        const archive = `_DESHECHOS/${Date.now()}/${current.archivoDestino}`;
        const archivePath = ws.path('resultados', ...archive.split('/'));
        mkdirSync(dirname(archivePath), { recursive: true });
        renameSync(generated, archivePath);
        removeEmptyDirs(dirname(generated), ws.path('resultados'));
      }
      delete manifest.archivos[current.archivoDestino];
    };
    // trazo de un mapa evaluado a mano: no tenía archivo de revisión, vuelve a no generarse
    if (!current.archivoOrigen) {
      archiveGenerated();
      delete reviews.decisiones[traza.id];
      traza.estado = 'NO_SE_GENERA';
      traza.archivo = null;
      traza.nombreFinal = null;
      delete traza.resolucionManual;
      updateMapStates(ws, report, reviews);
      persist(ws, manifest, reviews, report);
      return { traza, archivo: null };
    }
    const backup = ws.path('resultados', ...current.archivoRespaldo.split('/'));
    const source = ws.path('resultados', ...current.archivoOrigen.split('/'));
    if (!existsSync(backup)) throw new ActionError(`No se encuentra el respaldo: resultados/${current.archivoRespaldo}`, 409);
    if (existsSync(source)) throw new ActionError(`No se puede deshacer porque ya existe resultados/${current.archivoOrigen}`, 409);
    archiveGenerated();
    mkdirSync(dirname(source), { recursive: true });
    renameSync(backup, source);
    const restored = { ...current.manifiesto!, sha256: sha256(ws.read('resultados', ...current.archivoOrigen.split('/'))), tipo: 'revision' as const };
    delete restored.resolucionManual;
    manifest.archivos[current.archivoOrigen] = restored;
    delete reviews.decisiones[traza.id];
    traza.estado = 'REQUIERE_REVISION';
    traza.archivo = current.archivoOrigen;
    traza.nombreFinal = null;
    delete traza.resolucionManual;
    updateMapStates(ws, report, reviews);
    persist(ws, manifest, reviews, report);
    return { traza, archivo: `resultados/${current.archivoOrigen}` };
  }

  if (current) throw new ActionError('Este trazo ya fue resuelto; usa «Deshacer» para cambiar la decisión', 409);
  if (traza.estado !== 'REQUIERE_REVISION' || traza.rol !== 'principal' || traza.duplicadoDe) {
    throw new ActionError('El trazo ya no está pendiente de revisión', 409);
  }
  const sourceRel = Object.entries(manifest.archivos).find(([, m]) => m.traza === traza.id && m.tipo === 'revision')?.[0];
  if (!sourceRel || !ws.exists('resultados', ...sourceRel.split('/'))) {
    throw new ActionError('No hay un archivo de revisión registrado para este trazo', 409);
  }

  const sourcePath = ws.path('resultados', ...sourceRel.split('/'));
  const sourceEntry = manifest.archivos[sourceRel];
  const now = new Date().toISOString();
  const note = String(input.nota ?? '')
    .trim()
    .slice(0, 500);
  const origen = String(input.origen ?? '')
    .trim()
    .slice(0, 120);
  const destino = String(input.destino ?? '')
    .trim()
    .slice(0, 120);
  const nombre =
    input.accion === 'generar'
      ? safeOutputName(
          String(input.nombre ?? '')
            .trim()
            .replace(/\.kml$/i, ''),
        )
      : '';
  const type = input.tipo;
  const routeFolder = report.codigos.rutas.find((r) => r.slug === traza.ruta)?.carpeta ?? traza.ruta;
  const group = outputGroup(report, traza, lote.config.nomenclatura.alias);
  const outputRel = input.accion === 'generar' ? `${safeOutputName(report.zona)}/${safeOutputName(routeFolder)}/${group}/${nombre}.kml` : '';
  const dupla = input.accion === 'generar' ? groupDupla(report, traza, lote.config.nomenclatura.alias) : undefined;
  const resolution: ReviewResolution = {
    estado: input.accion === 'generar' ? 'generado' : 'descartado',
    geometriaEditada: input.accion === 'generar' && input.contenidoKml !== undefined,
    dupla,
    tipo: type,
    nombre,
    nota: note,
    origen,
    destino,
    sentido: input.sentido,
    relacionPrincipal: input.relacionPrincipal,
    archivoOrigen: sourceRel,
    archivoDestino: input.accion === 'generar' ? outputRel : '',
    archivoRespaldo: `${input.accion === 'descartar' ? '_DESCARTADOS' : '_RESUELTOS'}/${now.replace(/[:.]/g, '-')}/${sourceRel}`,
    manifiesto: sourceEntry,
    resueltoEn: now,
  };
  let generatedHash: string | undefined;

  if (input.accion === 'generar') {
    if (!type || !['propia', 'alternativa', 'ampliacion'].includes(type)) throw new ActionError('Elige ruta propia, alternativa o ampliación', 400);
    if (type === 'propia' && !input.contenidoKml && (!origen || !destino || !input.sentido || !['directo', 'inverso', 'circuito'].includes(input.sentido))) {
      throw new ActionError('Una ruta propia requiere origen, destino y sentido', 400);
    }
    if (ws.exists('resultados', ...outputRel.split('/')))
      throw new ActionError(`Ya existe resultados/${outputRel}; elige otro nombre para evitar sobrescribirlo`, 409);
    let output: string;
    try {
      const sourceMap = state?.mapas[traza.mapa];
      const original = sourceMap?.archivo ? ws.read('originales', sourceMap.archivo).toString('utf8') : '';
      if (!original) throw new Error('No se encontró el KML original');
      const main = type === 'propia' ? undefined : report.trazos.find((r) => r.id === input.relacionPrincipal);
      if (type !== 'propia' && (!main || main.id === traza.id || main.mapa !== traza.mapa || main.rol !== 'principal')) {
        throw new Error('Elige un recorrido principal del mismo mapa');
      }
      const mainMap = main && state?.mapas[main.mapa];
      const mainOriginal = mainMap?.archivo ? ws.read('originales', mainMap.archivo).toString('utf8') : undefined;
      resolution.origen = origen || main?.origen || '';
      resolution.destino = destino || main?.destino || '';
      if (input.contenidoKml !== undefined) {
        if (!input.contenidoKml.trim() || Buffer.byteLength(input.contenidoKml, 'utf8') > 8 * 1024 * 1024) {
          throw new Error('El KML editado está vacío o supera el tamaño permitido');
        }
        if (parseKmlAll(input.contenidoKml).length === 0) throw new Error('El KML editado no contiene recorridos válidos');
        output = input.contenidoKml;
      } else {
        const colonias = existsSync(lote.config.dirs.colonias) ? coloniaIndexFor(lote.config.dirs.colonias) : undefined;
        output = buildResolvedKml(traza, resolution, original, mainOriginal, main, colonias);
      }
      if (type === 'propia') {
        if (origen) traza.origen = origen;
        if (destino) traza.destino = destino;
        traza.sentido = input.sentido === 'inverso' ? 'contrario' : input.sentido === 'circuito' ? 'circuito' : 'confirmado';
      } else if (main) {
        traza.origen = resolution.origen || null;
        traza.destino = resolution.destino || null;
        traza.sentido = 'confirmado';
        const rel = previewFor(traza, report, state, ws)?.relacionadas.find((r) => r.traza === main.id)?.relacion;
        if (rel) traza.relacion = { principal: main.id, tipo: rel.tipo, invertir: rel.invertir, cobertura: rel.cobertura };
      }
    } catch (e) {
      throw new ActionError((e as Error).message, 400);
    }
    const target = ws.path('resultados', ...outputRel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    ws.write(['resultados', ...outputRel.split('/')], output);
    generatedHash = sha256(output);
    const entry: ReviewManifestEntry = {
      ...sourceEntry,
      sha256: generatedHash,
      tipo: 'resultado',
      resolucionManual: { tipo: type!, nombre, nota: note, resueltoEn: now },
    };
    resolution.manifiesto = entry;
    resolution.sha256Generado = generatedHash;
    manifest.archivos[outputRel] = entry;
    traza.estado = 'GENERADO';
    traza.archivo = outputRel;
    traza.nombreFinal = nombre;
    traza.resolucionManual = { estado: 'generado', tipo: type, nota: note, resueltoEn: now, dupla };
  } else {
    traza.estado = 'NO_SE_GENERA';
    traza.archivo = null;
    traza.resolucionManual = { estado: 'descartado', tipo: type, nota: note, resueltoEn: now };
  }

  const backup = ws.path('resultados', ...resolution.archivoRespaldo.split('/'));
  mkdirSync(dirname(backup), { recursive: true });
  renameSync(sourcePath, backup);
  delete manifest.archivos[sourceRel];
  reviews.decisiones[traza.id] = resolution;
  updateMapStates(ws, report, reviews);
  persist(ws, manifest, reviews, report);
  return { traza, archivo: generatedHash ? `resultados/${outputRel}` : null, resolucion: resolution };
}

export function resolveReview(lote: LoteInfo, input: ResolveReviewInput): ReviewItem {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock('resolución manual de revisión');
  try {
    const ruta = load(lote).report?.trazos.find((t) => t.id === input.traza)?.ruta;
    return withRenumber(lote, ruta ? [ruta] : [], () => [resolveReviewLocked(lote, input)])[0];
  } finally {
    release();
  }
}

export function resolveReviews(lote: LoteInfo, inputs: ResolveReviewInput[]): ReviewItem[] {
  if (inputs.length === 0 || inputs.length > 100) throw new ActionError('El lote de revisión debe incluir entre 1 y 100 trazos', 400);
  const ids = inputs.map((input) => input.traza);
  if (new Set(ids).size !== ids.length) throw new ActionError('El lote contiene trazos duplicados', 400);
  // Los trazos que el usuario eliminó en el editor llegan como «descartar»; el resto, con su KML editado
  if (inputs.some((input) => (input.accion === 'generar' ? input.tipo !== 'propia' || input.contenidoKml === undefined : input.accion !== 'descartar'))) {
    throw new ActionError('El lote debe contener KML editado para cada trazo que se generará', 400);
  }
  if (!inputs.some((input) => input.accion === 'generar')) throw new ActionError('El lote no genera ningún trazo; descártalos desde el centro de control', 400);

  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock('resolución manual de conflictos del mapa');
  try {
    const rutas = [...new Set((load(lote).report?.trazos ?? []).filter((t) => ids.includes(t.id)).map((t) => t.ruta))];
    return withRenumber(lote, rutas, () => resolveReviewsLocked(lote, inputs));
  } finally {
    release();
  }
}

function resolveReviewsLocked(lote: LoteInfo, inputs: ResolveReviewInput[]): ReviewItem[] {
  const { ws, report, manifest, reviews } = load(lote);
  if (!report) throw new ActionError('El lote todavía no tiene reporte para revisar', 404);
  // las carpetas se calculan como quedarán después de los descartes, que se aplican primero
  const discarded = new Set(inputs.filter((input) => input.accion === 'descartar').map((input) => input.traza));
  const afterDiscards: Report = {
    ...report,
    trazos: report.trazos.map((row) => (discarded.has(row.id) ? { ...row, estado: 'NO_SE_GENERA' as const } : row)),
  };
  let mapId: string | undefined;
  const outputPaths = new Set<string>();
  for (const input of inputs) {
    const traza = report.trazos.find((row) => row.id === input.traza);
    if (!traza || traza.estado !== 'REQUIERE_REVISION' || traza.rol !== 'principal' || traza.duplicadoDe || reviews.decisiones[traza.id]) {
      throw new ActionError(`El trazo ${input.traza} ya no está pendiente de revisión`, 409);
    }
    if (mapId !== undefined && mapId !== traza.mapa) throw new ActionError('Todos los trazos deben pertenecer al mismo mapa original', 400);
    mapId = traza.mapa;
    const sourceRel = Object.entries(manifest.archivos).find(([, entry]) => entry.traza === traza.id && entry.tipo === 'revision')?.[0];
    if (!sourceRel || !ws.exists('resultados', ...sourceRel.split('/'))) throw new ActionError(`El trazo ${input.traza} no tiene un archivo de revisión`, 409);
    if (input.accion === 'descartar') continue;
    let parsed: ReturnType<typeof parseKmlAll>;
    try {
      if (Buffer.byteLength(input.contenidoKml!, 'utf8') > 8 * 1024 * 1024) {
        throw new ActionError(`El KML editado del trazo ${input.traza} supera el tamaño permitido`, 413);
      }
      parsed = parseKmlAll(input.contenidoKml!);
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(`El KML editado del trazo ${input.traza} no es válido: ${(error as Error).message}`, 400);
    }
    if (parsed.length !== 1) throw new ActionError(`Cada trazo debe guardarse en su propio KML; ${input.traza} contiene ${parsed.length} trazos`, 400);
    const name = safeOutputName(
      String(input.nombre ?? '')
        .trim()
        .replace(/\.kml$/i, ''),
    );
    const routeFolder = report.codigos.rutas.find((route) => route.slug === traza.ruta)?.carpeta ?? traza.ruta;
    const group = outputGroup(afterDiscards, traza, lote.config.nomenclatura.alias);
    const outputRel = `${safeOutputName(report.zona)}/${safeOutputName(routeFolder)}/${group}/${name}.kml`;
    if (outputPaths.has(outputRel.toUpperCase())) throw new ActionError(`Dos trazos producirían el mismo archivo: resultados/${outputRel}`, 409);
    outputPaths.add(outputRel.toUpperCase());
    if (ws.exists('resultados', ...outputRel.split('/')))
      throw new ActionError(`Ya existe resultados/${outputRel}; cambia el nombre para evitar sobrescribirlo`, 409);
  }
  const ordered = [...inputs.filter((input) => input.accion === 'descartar'), ...inputs.filter((input) => input.accion !== 'descartar')];
  const results = new Map(ordered.map((input) => [input.traza, resolveReviewLocked(lote, input)]));
  return inputs.map((input) => results.get(input.traza)!);
}

/** Deshace todas las resoluciones (generadas y descartadas) de un mapa; valida todas antes de tocar archivos. */
export function undoMapReviews(lote: LoteInfo, mapa: string): ReviewItem[] {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock('deshacer la resolución del mapa');
  try {
    const { report, reviews } = load(lote);
    if (!report) throw new ActionError('El lote todavía no tiene reporte para revisar', 404);
    const rows = report.trazos.filter((t) => t.mapa === mapa && reviews.decisiones[t.id]);
    if (!rows.length) throw new ActionError('Este mapa no tiene resoluciones que deshacer', 409);
    for (const { id } of rows) {
      const current = reviews.decisiones[id];
      if (!current.archivoOrigen) continue; // de un mapa evaluado a mano: no hay respaldo que restaurar
      if (!ws.exists('resultados', ...current.archivoRespaldo.split('/'))) {
        throw new ActionError(`No se encuentra el respaldo: resultados/${current.archivoRespaldo}`, 409);
      }
      if (ws.exists('resultados', ...current.archivoOrigen.split('/'))) {
        throw new ActionError(`No se puede deshacer porque ya existe resultados/${current.archivoOrigen}`, 409);
      }
    }
    return withRenumber(lote, [...new Set(rows.map((t) => t.ruta))], () => rows.map(({ id }) => resolveReviewLocked(lote, { traza: id, accion: 'deshacer' })));
  } finally {
    release();
  }
}
