import type { PageResult } from '../../domain/classify';
import type { TraceInfo } from '../../domain/traces';
import type { DownloadSummary } from '../../io/download';
import type { OutputEntry } from '../../io/output';
import type { SourceScan } from '../../io/source';
import type { BatchState } from '../../io/store';
import type { TraceRow } from '@protocol';
import { buildReport, renderMarkdown, type Report } from '../report';
import type { RunContext } from './context';
import type { RunResult, RunSummary } from './types';

interface FinishInput {
  scan: SourceScan;
  state: BatchState;
  dl: DownloadSummary;
  /** La ejecución sólo actualizó la fuente o descargó: no hay clasificación que reportar. */
  onlySource?: boolean;
  pages?: PageResult[];
  rows?: TraceRow[];
  traces?: TraceInfo[];
  extra?: Parameters<typeof buildReport>[0]['extra'];
  entries?: OutputEntry[];
}

/** Etapa final: el reporte (del lote y de la ejecución) y el resumen que se devuelve. */
export function finishRun(ctx: RunContext, a: FinishInput): RunResult {
  const { cfg, opts, ws, ev } = ctx;
  const { scan, state } = a;
  opts.signal?.throwIfAborted();
  ev.stage('reporte');
  const report = buildReport({
    cfg,
    scan,
    state,
    dl: a.dl,
    started: ctx.started,
    tiempos: ctx.tiempos,
    errores: ctx.errores,
    pages: a.pages ?? [],
    traces: a.traces ?? [],
    rows: a.rows ?? [],
    extra: a.extra ?? {},
  });
  // El reporte del lote describe la clasificación de todo el lote; el de la ejecución, sólo su alcance
  if (!a.onlySource) {
    ws.writeJson(['reporte.json'], report);
    ws.write(['reporte.md'], renderMarkdown(report));
  }
  const scoped = ctx.scope ? scopeReport(report, ctx.scope) : report;
  if (opts.reportDir) {
    ws.writeJson([...opts.reportDir, 'reporte.json'], scoped);
    ws.write([...opts.reportDir, 'reporte.md'], renderMarkdown(scoped));
  }
  const sal = a.extra?.salida;
  const tipoOf = new Map((a.entries ?? []).map((e) => [e.rel, e.tipo]));
  const scopedRows = scoped.trazos.filter((r) => r.rol === 'principal' && !r.duplicadoDe);
  const resumen: RunSummary = {
    rutas: ctx.scope ? [...ctx.scope] : [...new Set(scan.maps.map((m) => m.pageSlug))],
    mapas: scan.maps.filter((m) => ctx.inScope(m.pageSlug)).length,
    mapasConError: scan.maps.filter((m) => ctx.inScope(m.pageSlug) && state.mapas[m.id]?.estado === 'ERROR').length,
    trazos: scoped.trazos.length,
    generados: scopedRows.filter((r) => r.estado === 'GENERADO').length,
    revision: scopedRows.filter((r) => r.estado === 'REQUIERE_REVISION').length,
    archivos: sal
      ? [
          ...sal.escritos.map((rel) => ({ rel: `resultados/${rel}`, tipo: tipoOf.get(rel) ?? 'resultado', estado: 'nuevo' as const })),
          ...sal.actualizados.map((rel) => ({ rel: `resultados/${rel}`, tipo: tipoOf.get(rel) ?? 'resultado', estado: 'actualizado' as const })),
          ...sal.sinCambios.map((rel) => ({ rel: `resultados/${rel}`, tipo: tipoOf.get(rel) ?? 'resultado', estado: 'sin-cambios' as const })),
        ]
      : [],
    obsoletos: sal?.obsoletos.map((r) => `resultados/${r}`) ?? [],
    conflictos: sal?.conflictos ?? [],
    errores: [
      ...ctx.errores,
      ...scan.maps.filter((m) => ctx.inScope(m.pageSlug) && state.mapas[m.id]?.estado === 'ERROR').map((m) => `${m.title}: ${state.mapas[m.id]!.error}`),
    ],
    advertencias: ctx.advertencias,
  };
  ev.info('ORCHESTRATOR', `Terminó: ${resumen.generados} generado(s), ${resumen.revision} en revisión, ${resumen.mapasConError} mapa(s) con error`);
  return { reportePath: opts.reportDir ? ws.path(...opts.reportDir, 'reporte.md') : ws.path('reporte.md'), report: scoped, state, resumen };
}

/** El reporte limitado a unas rutas (para la vista de una ejecución). */
function scopeReport(r: Report, scope: Set<string>): Report {
  const maps = new Set(r.mapas.filter((m) => scope.has(m.ruta)).map((m) => m.id));
  const trazos = r.trazos.filter((t) => scope.has(t.ruta));
  return {
    ...r,
    paginas: r.paginas.filter((p) => scope.has(p.slug)),
    mapas: r.mapas.filter((m) => maps.has(m.id)),
    trazos,
    duplicados: r.duplicados.filter((d) => scope.has(d.rutaA) || scope.has(d.rutaB)),
    etiquetados: { ...r.etiquetados, detalle: r.etiquetados.detalle.filter((d) => d.traza && trazos.some((t) => t.id === d.traza)) },
    ia: { ...r.ia, intervenciones: r.ia.intervenciones.filter((i) => maps.has(i.mapa)) },
    codigos: { ...r.codigos, rutas: r.codigos.rutas.filter((x) => scope.has(x.slug)) },
    resumen: {
      ...r.resumen,
      paginas: [...scope].length,
      mapasEncontrados: maps.size,
      mapasConError: r.mapas.filter((m) => maps.has(m.id) && m.estado === 'ERROR').length,
      trazos: trazos.length,
      itinerariosPrincipales: trazos.filter((t) => t.rol === 'principal' && !t.duplicadoDe).length,
      generados: trazos.filter((t) => t.estado === 'GENERADO').length,
      requierenRevision: trazos.filter((t) => t.estado === 'REQUIERE_REVISION').length,
    },
  };
}
