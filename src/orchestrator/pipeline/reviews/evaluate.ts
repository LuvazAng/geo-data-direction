import { parseKmlAll } from '@core';
import { Workspace, sha256 } from '../../io/store';
import type { LoteInfo } from '../../config';
import { ActionError } from '../../errors';
import type { MapDecision, ReviewItem, ReviewManifestEntry, ReviewResolution } from '@protocol';
import { duplaFolders, duplaKey, renumberRoute, safeOutputName, targetOf, withRenumber } from './duplas';
import { undecidedWithoutItineraries, updateMapStates } from './status';
import { load, persist } from './store';

// Evaluar a mano un mapa sin itinerarios, o descartarlo.

export interface EvaluateMapInput {
  mapa: string;
  /** Trazos que quedaron en el editor: su KML editado y su dupla dentro del mapa (1, 2…). */
  generar: { traza: string; nombre: string; contenidoKml: string; dupla: number; nota?: string }[];
  /** Trazos del mapa que se eliminaron en el editor. */
  descartar: { traza: string; nota?: string }[];
}

/**
 * Evaluación manual de un mapa sin itinerarios utilizables: los trazos que el usuario dejó se
 * generan, cada dupla en su carpeta en el lugar del mapa dentro de la ruta (las carpetas de los
 * mapas siguientes se recorren); los que eliminó quedan descartados. Se deshace por mapa o por trazo.
 */
export function evaluateMap(lote: LoteInfo, input: EvaluateMapInput): ReviewItem[] {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock('evaluación manual del mapa');
  try {
    const ruta = load(lote).report?.trazos.find((t) => t.mapa === input.mapa)?.ruta;
    return withRenumber(lote, ruta ? [ruta] : [], () => evaluateMapLocked(lote, input));
  } finally {
    release();
  }
}

function evaluateMapLocked(lote: LoteInfo, input: EvaluateMapInput): ReviewItem[] {
  const { ws, manifest, report, reviews, state } = load(lote);
  if (!report) throw new ActionError('El lote todavía no tiene reporte para revisar', 404);
  if (!undecidedWithoutItineraries(report, reviews, state, input.mapa)) {
    throw new ActionError('Sólo se evalúa a mano un mapa sin itinerarios utilizables y sin resoluciones; usa «Resolver conflictos» o «Deshacer»', 409);
  }
  if (!input.generar.length) throw new ActionError('Deja en el editor al menos un trazo para generar; si el mapa no tiene nada, descártalo', 400);
  const own = new Map(report.trazos.filter((t) => t.mapa === input.mapa).map((t) => [t.id, t]));
  const ids = [...input.generar, ...input.descartar].map((item) => item.traza);
  if (new Set(ids).size !== ids.length) throw new ActionError('El lote contiene trazos duplicados', 400);
  const unknown = ids.find((id) => !own.has(id));
  if (unknown) throw new ActionError(`El trazo ${unknown} no pertenece a este mapa`, 400);
  for (const item of input.generar) {
    if (!Number.isInteger(item.dupla) || item.dupla < 1) throw new ActionError(`Dupla inválida para el trazo ${item.traza}`, 400);
    let parsed: ReturnType<typeof parseKmlAll>;
    try {
      if (Buffer.byteLength(item.contenidoKml, 'utf8') > 8 * 1024 * 1024)
        throw new ActionError(`El KML editado del trazo ${item.traza} supera el tamaño permitido`, 413);
      parsed = parseKmlAll(item.contenidoKml);
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(`El KML editado del trazo ${item.traza} no es válido: ${(error as Error).message}`, 400);
    }
    if (parsed.length !== 1) throw new ActionError(`Cada trazo debe guardarse en su propio KML; ${item.traza} contiene ${parsed.length} trazos`, 400);
  }

  // las duplas elegidas se registran primero: con ellas se calculan las carpetas de toda la ruta
  const now = new Date().toISOString();
  const ruta = own.values().next().value!.ruta;
  const kept = input.generar.map((item) => {
    const row = own.get(item.traza)!;
    const nota = String(item.nota ?? 'Mapa evaluado a mano en el editor')
      .trim()
      .slice(0, 500);
    row.estado = 'GENERADO';
    row.resolucionManual = { estado: 'generado', tipo: 'propia', nota, resueltoEn: now, grupoMapa: item.dupla };
    return { row, item, nota, nombre: safeOutputName(item.nombre.trim().replace(/\.kml$/i, '')) };
  });
  const folders = duplaFolders(report.trazos, ruta);
  const routeFolder = report.codigos.rutas.find((r) => r.slug === ruta)?.carpeta ?? ruta;
  const outputs = kept.map(({ row, nombre }) => `${safeOutputName(report.zona)}/${safeOutputName(routeFolder)}/${folders.get(duplaKey(row)!)}/${nombre}.kml`);
  // un archivo que ya existe sólo se acepta si es de otro mapa y se va a recorrer de carpeta
  const vacated = new Set(
    report.trazos.filter((r) => r.archivo && r.estado === 'GENERADO' && targetOf(r, folders) !== r.archivo).map((r) => r.archivo!.toUpperCase()),
  );
  outputs.forEach((rel, i) => {
    if (outputs.findIndex((other) => other.toUpperCase() === rel.toUpperCase()) !== i)
      throw new ActionError(`Dos trazos producirían el mismo archivo: resultados/${rel}`, 409);
    if (ws.exists('resultados', ...rel.split('/')) && !vacated.has(rel.toUpperCase())) {
      throw new ActionError(`Ya existe resultados/${rel}; cambia el nombre para evitar sobrescribirlo`, 409);
    }
  });

  renumberRoute(ws, manifest, reviews, report, ruta);
  const map = state!.mapas[input.mapa];
  const items = kept.map(({ row, item, nota, nombre }, i): ReviewItem => {
    const rel = outputs[i];
    ws.write(['resultados', ...rel.split('/')], item.contenidoKml);
    const entry: ReviewManifestEntry = {
      sha256: sha256(item.contenidoKml),
      tipo: 'resultado',
      traza: row.id,
      mapa: row.mapa,
      fuente: map.downloadUrl,
      original: `originales/${map.archivo}`,
      generadoEn: now,
      resolucionManual: { tipo: 'propia', nombre, nota, resueltoEn: now },
    };
    manifest.archivos[rel] = entry;
    const resolucion: ReviewResolution = {
      estado: 'generado',
      geometriaEditada: true,
      grupoMapa: item.dupla,
      tipo: 'propia',
      nombre,
      nota,
      archivoOrigen: '',
      archivoDestino: rel,
      archivoRespaldo: '',
      sha256Generado: entry.sha256,
      manifiesto: entry,
      resueltoEn: now,
    };
    reviews.decisiones[row.id] = resolucion;
    row.archivo = rel;
    row.nombreFinal = nombre;
    return { traza: row, archivo: `resultados/${rel}`, resolucion };
  });
  for (const item of input.descartar) {
    const row = own.get(item.traza)!;
    const nota = String(item.nota ?? 'Eliminado en el editor al evaluar el mapa')
      .trim()
      .slice(0, 500);
    const resolucion: ReviewResolution = { estado: 'descartado', nota, archivoOrigen: '', archivoDestino: '', archivoRespaldo: '', resueltoEn: now };
    reviews.decisiones[row.id] = resolucion;
    row.resolucionManual = { estado: 'descartado', nota, resueltoEn: now };
    items.push({ traza: row, archivo: null, resolucion });
  }
  updateMapStates(ws, report, reviews);
  persist(ws, manifest, reviews, report);
  return items;
}

/** Descarta completo un mapa sin itinerarios (nada que generar) o deshace ese descarte. */
export function decideMap(lote: LoteInfo, mapa: string, accion: 'descartar' | 'deshacer', nota = ''): MapDecision | null {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const release = ws.lock(accion === 'descartar' ? 'descarte del mapa' : 'deshacer el descarte del mapa');
  try {
    const { manifest, report, reviews, state } = load(lote);
    if (!report) throw new ActionError('El lote todavía no tiene reporte para revisar', 404);
    let decision: MapDecision | null = null;
    if (accion === 'descartar') {
      if (!undecidedWithoutItineraries(report, reviews, state, mapa)) {
        throw new ActionError('Sólo se descarta completo un mapa sin itinerarios utilizables y sin resoluciones', 409);
      }
      decision = { estado: 'descartado', nota: nota.trim().slice(0, 500), resueltoEn: new Date().toISOString() };
      reviews.mapas = { ...reviews.mapas, [mapa]: decision };
    } else {
      if (!reviews.mapas?.[mapa]) throw new ActionError('Este mapa no está descartado', 409);
      delete reviews.mapas[mapa];
    }
    updateMapStates(ws, report, reviews);
    persist(ws, manifest, reviews, report);
    return decision;
  } finally {
    release();
  }
}
