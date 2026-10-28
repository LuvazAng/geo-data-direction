import { parseKmlAll, canBuildAlternative, RELATION_TEXT, relate } from '@core';
import type { Report } from '../report';
import { Workspace, type BatchState } from '../../io/store';
import type { LoteInfo } from '../../config';
import type { MapWithoutItineraries, ReviewAlternative, ReviewItem, ReviewSnapshot, TraceRow } from '@protocol';
import { mapStatus, undecidedWithoutItineraries } from './status';
import { load } from './store';

// Lo que ve el centro de control: casos pendientes y resueltos, con una vista previa de cada uno.

export function reviewSnapshot(lote: LoteInfo): ReviewSnapshot {
  const { ws, manifest, report, reviews, state } = load(lote);
  const traces = new Map((report?.trazos ?? []).map((t) => [t.id, t]));
  const pending = (report?.trazos ?? [])
    .filter((t) => t.estado === 'REQUIERE_REVISION' && t.rol === 'principal' && !t.duplicadoDe && !reviews.decisiones[t.id])
    .map((traza): ReviewItem => {
      const rel = Object.entries(manifest.archivos).find(([, m]) => m.traza === traza.id && m.tipo === 'revision')?.[0];
      return {
        traza,
        archivo: rel ? `resultados/${rel}` : null,
        archivoOriginal: state?.mapas[traza.mapa]?.archivo ? `originales/${state.mapas[traza.mapa].archivo}` : null,
        totalTrazosMapa: (report?.trazos ?? []).filter((other) => other.mapa === traza.mapa).length,
        nombresMapa: (report?.trazos ?? [])
          .filter((other) => other.mapa === traza.mapa && !other.duplicadoDe)
          .map((other) => ({ indice: other.indice, nombre: other.nombreFinal ?? other.nombrePropuesto }))
          .filter((item): item is { indice: number; nombre: string } => !!item.nombre),
        pendientesMapa: (report?.trazos ?? [])
          .filter(
            (other) =>
              other.mapa === traza.mapa &&
              other.estado === 'REQUIERE_REVISION' &&
              other.rol === 'principal' &&
              !other.duplicadoDe &&
              !reviews.decisiones[other.id],
          )
          .map((other) => ({ traza: other.id, indice: other.indice, nombre: other.nombreFinal ?? other.nombrePropuesto ?? undefined })),
        preview: previewFor(traza, report!, state, ws),
      };
    });
  const resolved = Object.entries(reviews.decisiones)
    .flatMap(([id, resolucion]): ReviewItem[] => {
      const traza = traces.get(id);
      return traza ? [{ traza, archivo: resolucion.estado === 'generado' ? `resultados/${resolucion.archivoDestino}` : null, resolucion }] : [];
    })
    .sort((a, b) => b.resolucion!.resueltoEn.localeCompare(a.resolucion!.resueltoEn));
  const sinItinerarios = (report?.mapas ?? [])
    .filter((map) => undecidedWithoutItineraries(report!, reviews, state, map.id))
    .map((map): MapWithoutItineraries => ({
      mapa: map.id,
      motivo: mapStatus(report!.trazos, map.id, false).error!,
      archivoOriginal: state?.mapas[map.id]?.archivo ? `originales/${state.mapas[map.id].archivo}` : null,
      trazos: report!.trazos.filter((t) => t.mapa === map.id).map((t) => ({ traza: t.id, indice: t.indice })),
    }));
  const mapasDescartados = Object.entries(reviews.mapas ?? {}).map(([mapa, decision]) => ({ mapa, ...decision }));
  return { pendientes: pending, resueltas: resolved, sinItinerarios, mapasDescartados };
}

export function previewFor(traza: TraceRow, report: Report, state: BatchState | null, ws: Workspace): ReviewItem['preview'] {
  const map = state?.mapas[traza.mapa];
  if (!map?.archivo) return undefined;
  try {
    const parsed = parseKmlAll(ws.read('originales', map.archivo).toString('utf8'));
    const candidate = parsed.find((p) => p.index === traza.indice);
    if (!candidate) return { coords: [], relacionadas: [], error: `No se encontró el trazo #${traza.indice + 1} en el original.` };
    const relacionadas = report.trazos
      .filter((other) => other.id !== traza.id && other.mapa === traza.mapa && other.rol === 'principal' && !other.duplicadoDe)
      .flatMap((other): ReviewAlternative[] => {
        const main = parsed.find((p) => p.index === other.indice);
        if (!main) return [];
        const rel = relate(candidate.coords, main.coords);
        return [
          {
            traza: other.id,
            titulo: `${other.tituloMapa} #${other.indice + 1}`,
            descripcion: other.descripcion || other.nombreOriginal,
            coords: main.coords,
            relacion: {
              tipo: rel.kind,
              texto: RELATION_TEXT[rel.kind],
              invertir: rel.needsReverse,
              cobertura: rel.overlap,
              distanciaM: Math.round(rel.gap),
              verticeSalida: rel.outVertex,
              verticeRegreso: rel.inVertex,
              coordSalida: rel.outCoord,
              coordRegreso: rel.inCoord,
              sePuedeUnir: canBuildAlternative(rel),
            },
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.relacion.sePuedeUnir) - Number(a.relacion.sePuedeUnir) ||
          b.relacion.cobertura - a.relacion.cobertura ||
          a.relacion.distanciaM - b.relacion.distanciaM,
      );
    return { coords: candidate.coords, relacionadas };
  } catch (e) {
    return { coords: [], relacionadas: [], error: `No se pudo preparar la vista previa: ${(e as Error).message}` };
  }
}
