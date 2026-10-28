import { relevantHits, type PageResult, type TraceDecision } from '../../domain/classify';
import type { TraceInfo } from '../../domain/traces';
import type { MapRef } from '../../io/source';
import type { CodeSource, TraceRow } from '@protocol';

/** Cómo se llegó a la decisión: de dónde salieron los nombres y qué evidencias contaron. */
function metodo(d: TraceDecision): string {
  const fuentes = [...new Set(d.evidencias.filter((e) => e.peso !== 0).map((e) => e.fuente))];
  const nombres = d.fuenteNombres ?? 'sin nombres';
  return `${nombres}${fuentes.length ? ' + ' + fuentes.join(' + ') : ''}`;
}

/** La fila de un trazo en la tabla del reporte. */
export function traceRow(
  d: TraceDecision,
  t: TraceInfo,
  ref: MapRef,
  page: PageResult,
  fin: { nombre: string; archivo: string; codigos: Record<string, CodeSource | null> } | undefined,
  ok: boolean,
  review: boolean,
  extra: Partial<TraceRow> = {},
): TraceRow {
  const dupla = page.duplas.find((x) => x.id === d.dupla);
  const hit = (e: TraceDecision['inicio']) => relevantHits(e)[0];
  return {
    id: d.traceId,
    ruta: page.slug,
    mapa: d.mapId,
    mapaAsignado: d.assignedMapId,
    tituloMapa: ref.title,
    orden: ref.order,
    indice: d.index,
    nombreOriginal: t.name,
    descripcion: t.text.DESCRIPCIO ?? '',
    autoAmpl: t.text['AUTO-AMPL'] ?? '',
    oid: t.text.OID ?? '',
    rol: d.role,
    longitudKm: Number((t.lengthM / 1000).toFixed(2)),
    origen: d.origen,
    destino: d.destino,
    via: d.via,
    variante: d.variante,
    fuenteNombres: d.fuenteNombres,
    inicio: { coord: t.first, localidad: hit(d.inicio)?.nombre ?? null, distanciaM: hit(d.inicio)?.distanciaM ?? null, municipio: d.inicio.municipio ?? null },
    final: { coord: t.last, localidad: hit(d.final)?.nombre ?? null, distanciaM: hit(d.final)?.distanciaM ?? null, municipio: d.final.municipio ?? null },
    sentido: d.sentido,
    puntaje: d.puntaje,
    evidencias: d.evidencias,
    dupla: dupla?.n ?? null,
    similitudDupla: dupla?.similitud ? { clase: dupla.similitud.clase, similitud: dupla.similitud.similitud, sentido: dupla.similitud.sentido } : null,
    nombreFinal: ok ? fin!.nombre : null,
    nombrePropuesto: !ok && fin ? fin.nombre : null,
    codigos: fin?.codigos ?? null,
    metodo: metodo(d),
    estado: d.role !== 'principal' || d.duplicadoDe ? 'NO_SE_GENERA' : ok ? 'GENERADO' : 'REQUIERE_REVISION',
    motivosRevision: review ? d.revision : [],
    duplicadoDe: d.duplicadoDe ?? null,
    relacion: d.relacion ?? null,
    anomalias: t.anomalies,
    archivo: null,
    ...extra,
  };
}
