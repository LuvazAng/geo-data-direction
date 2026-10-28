import { analyzeKml, type MapTraces, type TraceInfo } from '../../domain/traces';
import { kmlTextOf } from '../../io/download';
import type { MapRef, SourceScan } from '../../io/source';
import { setEstado, type BatchState } from '../../io/store';
import type { RunContext } from './context';
import { breathe } from './shared';

export interface Analysis {
  analyzed: { ref: MapRef; data: MapTraces; text: string }[];
  traceById: Map<string, TraceInfo>;
  /** Texto KML original de cada mapa. */
  textOf: Map<string, string>;
  refOf: Map<string, MapRef>;
}

/** Etapa 4: análisis de todo el lote (es el contexto para comparar y nombrar de forma estable). */
export async function analyzeLote(ctx: RunContext, scan: SourceScan, state: BatchState): Promise<Analysis> {
  const { cfg, ws, ev } = ctx;
  const analyzed = await ctx.stage('analisis', async () => {
    const out: Analysis['analyzed'] = [];
    for (const ref of scan.maps) {
      await breathe();
      const m = state.mapas[ref.id];
      if (!m?.archivo || !ws.exists('originales', m.archivo)) continue;
      try {
        const text = await kmlTextOf(ws.read('originales', m.archivo), cfg.fuente.maxBytes);
        const data = analyzeKml(ref.id, text);
        out.push({ ref, data, text });
        if (ctx.inScope(ref.pageSlug)) {
          if (m.estado !== 'ERROR') setEstado(m, 'ANALIZADO');
          ev.file('analizado', ref.pageSlug, { mapa: ref.id, rel: `originales/${m.archivo}`, detalle: `${data.traces.length} trazo(s)` });
          for (const a of [...data.anomalies, ...data.traces.flatMap((t) => t.anomalies.map((x) => `trazo ${t.index}: ${x}`))]) {
            ev.debug('GEOMETRY', `${ref.title}: ${a}`, { ruta: ref.pageSlug, mapa: ref.id });
          }
        }
      } catch (e) {
        if (ctx.inScope(ref.pageSlug)) setEstado(m, 'ERROR', { error: `Archivo inválido: ${(e as Error).message}` });
        ev.error('GEOMETRY', `${ref.title}: ${(e as Error).message}`, { ruta: ref.pageSlug, mapa: ref.id });
      }
    }
    ws.saveState(state);
    return out;
  });
  const traceById = new Map<string, TraceInfo>();
  for (const a of analyzed) for (const t of a.data.traces) traceById.set(t.id, t);
  const textOf = new Map(analyzed.map((a) => [a.ref.id, a.text]));
  const refOf = new Map(scan.maps.map((r) => [r.id, r]));
  ev.info('GEOMETRY', `Análisis: ${analyzed.length} archivo(s), ${traceById.size} trazo(s) del lote`);
  return { analyzed, traceById, textOf, refOf };
}
