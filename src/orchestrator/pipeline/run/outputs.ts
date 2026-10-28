import { buildKml, relate } from '@core';
import { relevantHits, type TraceDecision } from '../../domain/classify';
import type { RouteCode } from '../../domain/naming';
import { writeOutputs, type OutputEntry } from '../../io/output';
import type { SourceScan } from '../../io/source';
import { safeName, setEstado, type BatchState } from '../../io/store';
import type { MapDecision, ReviewResolution, TraceRow } from '@protocol';
import { buildResolvedKml, duplaFolders, mapStatus } from '../reviews';
import type { Analysis } from './analysis';
import type { Classification } from './classification';
import type { RunContext } from './context';
import type { FinalName } from './naming';
import { traceRow } from './rows';
import { isOk, OK_SENTIDOS } from './shared';

/**
 * Etapa 10 (primera parte): qué archivos se generan y cómo queda cada fila del reporte. Respeta lo que
 * el usuario ya resolvió a mano y los mapas que descartó. Sólo se escribe lo que abarca la ejecución.
 */
export function collectOutputs(
  ctx: RunContext,
  state: BatchState,
  { traceById, refOf, textOf }: Pick<Analysis, 'traceById' | 'refOf' | 'textOf'>,
  {
    decisions,
    pageOf,
    decById,
    colonias,
    coloniasDe,
    pageOrder,
  }: Pick<Classification, 'decisions' | 'pageOf' | 'decById' | 'colonias' | 'coloniasDe' | 'pageOrder'>,
  finalName: Map<string, FinalName>,
  routeCodes: Map<string, RouteCode>,
) {
  const { cfg, ws } = ctx;
  const entries: OutputEntry[] = [];
  const rows: TraceRow[] = [];
  const reviewStore = ws.readJson<{ version: 1; decisiones: Record<string, ReviewResolution>; mapas?: Record<string, MapDecision> }>(['revisiones.json'], {
    version: 1,
    decisiones: {},
  });
  const manualReviews = reviewStore.decisiones;
  const discardedMaps = reviewStore.mapas ?? {};
  for (const d of decisions) {
    const t = traceById.get(d.traceId)!;
    const ref = refOf.get(d.mapId)!;
    const page = pageOf.get(d.traceId)!;
    const fin = finalName.get(d.traceId);
    // de un mapa que el usuario descartó completo no se genera nada
    const discarded = !!discardedMaps[d.mapId];
    const ok = d.role === 'principal' && !d.duplicadoDe && OK_SENTIDOS.has(d.sentido) && d.revision.length === 0 && !!fin && !discarded;
    const review = d.role === 'principal' && !d.duplicadoDe && !ok && !discarded;
    const manual = manualReviews[d.traceId];
    const desc = (end: TraceDecision['inicio'], label: string | null) => {
      const h = relevantHits(end)[0];
      return [label, h ? `${h.nombre}${h.dentro ? '' : ` (a ${h.distanciaM} m)`}` : null, end.municipio && `mpio. ${end.municipio}`]
        .filter(Boolean)
        .join(' · ');
    };
    let extra: Partial<TraceRow> = {};
    if (!manual && !discarded && (ok || (review && cfg.salida.copiarRevision) || (!cfg.salida.soloPrincipales && d.role !== 'principal'))) {
      const dupla = page.duplas.find((x) => x.id === d.dupla);
      const rel = ok
        ? fin!.archivo
        : `_REVISION/${safeName(routeCodes.get(page.slug)!.carpeta)}/${ref.order}-${d.index} ${safeName(`${d.origen ?? '¿?'}-${d.destino ?? '¿?'}`)}.kml`;
      extra = { archivo: rel, duplaN: dupla?.n };
      if (ctx.inScope(page.slug)) {
        const kml = buildKml(textOf.get(d.mapId)!, {
          reversed: false,
          index: d.index,
          name: ok ? fin!.nombre : undefined,
          startDescription: desc(d.inicio, d.origen),
          endDescription: desc(d.final, d.destino),
          colonias: coloniasDe(t.coords),
        });
        entries.push({
          rel,
          kml,
          tipo: ok ? 'resultado' : 'revision',
          traza: d.traceId,
          mapa: d.mapId,
          fuente: ref.downloadUrl,
          original: `originales/${state.mapas[d.mapId]?.archivo}`,
        });
      }
    }
    const row = traceRow(d, t, ref, page, fin, ok, review, manual?.estado === 'generado' ? { archivo: manual.archivoDestino } : extra);
    if (discarded && !manual) row.estado = 'NO_SE_GENERA';
    if (manual) {
      row.estado = manual.estado === 'generado' ? 'GENERADO' : 'NO_SE_GENERA';
      row.archivo = manual.estado === 'generado' ? manual.archivoDestino : null;
      row.nombreFinal = manual.estado === 'generado' ? (manual.nombre ?? null) : null;
      row.resolucionManual = {
        estado: manual.estado,
        tipo: manual.tipo,
        nota: manual.nota,
        resueltoEn: manual.resueltoEn,
        dupla: manual.dupla,
        grupoMapa: manual.grupoMapa,
      };
      if (manual.estado === 'generado') {
        const mainDec = manual.relacionPrincipal ? decById.get(manual.relacionPrincipal) : undefined;
        const mainTrace = mainDec ? traceById.get(mainDec.traceId) : undefined;
        const mainRef = mainDec ? refOf.get(mainDec.mapId) : undefined;
        const mainPage = mainDec ? pageOf.get(mainDec.traceId) : undefined;
        const mainRow =
          mainDec && mainTrace && mainRef && mainPage
            ? traceRow(mainDec, mainTrace, mainRef, mainPage, finalName.get(mainDec.traceId), isOk(mainDec), mainDec.revision.length > 0)
            : undefined;
        if (manual.tipo === 'propia') {
          row.origen = manual.origen ?? row.origen;
          row.destino = manual.destino ?? row.destino;
          row.sentido = manual.sentido === 'inverso' ? 'contrario' : manual.sentido === 'circuito' ? 'circuito' : 'confirmado';
        } else if (mainTrace && mainDec) {
          row.origen = manual.origen ?? mainRow?.origen ?? row.origen;
          row.destino = manual.destino ?? mainRow?.destino ?? row.destino;
          row.sentido = 'confirmado';
          const relation = relate(t.coords, mainTrace.coords);
          row.relacion = { principal: mainTrace.id, tipo: relation.kind, invertir: relation.needsReverse, cobertura: relation.overlap };
        }
        if (ctx.inScope(page.slug)) {
          const kml = manual.geometriaEditada
            ? ws.read('resultados', ...manual.archivoDestino.split('/')).toString('utf8')
            : buildResolvedKml(row, manual, textOf.get(d.mapId)!, mainRow && textOf.get(mainRow.mapa), mainRow, colonias);
          entries.push({
            rel: manual.archivoDestino,
            kml,
            tipo: 'resultado',
            traza: d.traceId,
            mapa: d.mapId,
            fuente: ref.downloadUrl,
            original: `originales/${state.mapas[d.mapId]?.archivo}`,
          });
        }
      }
    }
    rows.push(row);
  }
  // Carpetas de dupla sin huecos: las duplas que se descartaron o se juntaron al resolver a mano
  // no dejan su número vacío (los resultados manuales ya quedaron en su carpeta al resolverse).
  const entryOf = new Map(entries.filter((e) => e.tipo === 'resultado').map((e) => [e.traza, e]));
  for (const slug of pageOrder) {
    const folders = duplaFolders(rows, slug);
    for (const row of rows) {
      if (row.ruta !== slug || row.estado !== 'GENERADO' || row.resolucionManual || !row.archivo || row.dupla === null) continue;
      const n = folders.get(row.dupla);
      const parts = row.archivo.split('/');
      if (n === undefined || parts.length < 2 || !/^\d+$/.test(parts[parts.length - 2])) continue;
      const rel = [...parts.slice(0, -2), String(n), parts[parts.length - 1]].join('/');
      const entry = entryOf.get(row.id);
      if (entry?.rel === row.archivo) entry.rel = rel;
      row.archivo = rel;
    }
  }
  return { entries, rows, discardedMaps };
}

/**
 * Etapa 10 (segunda parte): escribir los archivos. A partir de aquí ya no se cancela: la escritura
 * termina completa (cada archivo es atómico y el manifiesto se actualiza al final).
 */
export async function writeResults(ctx: RunContext, scan: SourceScan, entries: OutputEntry[], refOf: Analysis['refOf']) {
  const { ws, ev } = ctx;
  ctx.opts.signal?.throwIfAborted();
  const scopeMapIds = ctx.scope ? new Set(scan.maps.filter((m) => ctx.inScope(m.pageSlug)).map((m) => m.id)) : undefined;
  const salida = await ctx.stage('salida', () => writeOutputs(ws, entries, new Date(), scopeMapIds));
  const slugOfEntry = new Map(entries.map((e) => [e.rel, refOf.get(e.mapa)!.pageSlug]));
  const tipoOf = new Map(entries.map((e) => [e.rel, e.tipo]));
  for (const rel of salida.escritos) ev.file(tipoOf.get(rel) === 'revision' ? 'revision' : 'generado', slugOfEntry.get(rel)!, { rel: `resultados/${rel}` });
  for (const rel of salida.actualizados) ev.file('actualizado', slugOfEntry.get(rel)!, { rel: `resultados/${rel}` });
  for (const rel of salida.obsoletos) ev.file('obsoleto', '', { rel: `resultados/${rel}` });
  for (const c of salida.conflictos) {
    ev.file('conflicto', slugOfEntry.get(c.rel) ?? '', { rel: `resultados/${c.rel}`, detalle: c.motivo });
    ev.warn('OUTPUT', `${c.rel}: ${c.motivo}`);
    ctx.advertencias.push(`${c.rel}: ${c.motivo}`);
  }
  ev.info(
    'OUTPUT',
    `${salida.escritos.length} nuevo(s), ${salida.actualizados.length} actualizado(s), ${salida.sinCambios.length} sin cambios, ${salida.conflictos.length} conflicto(s), ${salida.obsoletos.length} obsoleto(s)`,
  );
  return salida;
}

/** Etapa 11 (primera parte): estado final de cada mapa que abarca la ejecución. */
export function closeMapStates(ctx: RunContext, scan: SourceScan, state: BatchState, rows: TraceRow[], discardedMaps: Record<string, MapDecision>) {
  for (const ref of scan.maps) {
    if (!ctx.inScope(ref.pageSlug)) continue;
    const m = state.mapas[ref.id];
    if (!m || m.estado === 'ERROR') continue;
    const next = mapStatus(rows, ref.id, !!discardedMaps[ref.id]);
    setEstado(m, next.estado, next.error ? { error: next.error } : {});
  }
  ctx.ws.saveState(state);
}
