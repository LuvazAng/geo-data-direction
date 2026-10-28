import { emitter, formatEvent, type Emit, type PipelineEvent } from '@protocol';
import type { OrqConfig } from '../config';
import { Workspace } from '../io/store';
import { askQwen } from './run/ai';
import { analyzeLote } from './run/analysis';
import { classifyLote } from './run/classification';
import { compareLote } from './run/comparison';
import { createContext } from './run/context';
import { downloadStage, emptyDownload } from './run/download';
import { finishRun } from './run/finish';
import { labeledRowsOf, learnCodes, matchLabeled } from './run/labeled';
import { nameTraces } from './run/naming';
import { closeMapStates, collectOutputs, writeResults } from './run/outputs';
import { checkData } from './run/preflight';
import { loadReferences, readSource } from './run/source';
import type { RunOptions, RunResult } from './run/types';

// El orquestador: lee la fuente, descarga los mapas, los analiza y clasifica, compara, nombra y escribe
// los resultados y el reporte. Cada etapa vive en ./run; aquí sólo se encadenan.

export type { RunOptions, RunResult, RunSummary, Validation } from './run/types';

export async function run(cfg: OrqConfig, opts: RunOptions = {}): Promise<RunResult> {
  // antes de crear carpetas o usar la red: sin lo imprescindible no tiene caso empezar
  if (!opts.soloFuente && !opts.soloDescarga) checkData(cfg);
  const emit: Emit = (e) => {
    opts.emit?.(e);
    if (opts.log) {
      const s = formatEvent(e);
      if (s && e.tipo === 'log' && e.nivel !== 'DEBUG') opts.log(s);
    }
  };
  const ev = emitter(emit);
  const ws = new Workspace(cfg.dirs.trabajo, cfg.lote);
  const release = ws.lock(opts.owner ?? `orquestador (pid ${process.pid})`);
  try {
    return await runLocked(cfg, opts, ws, ev);
  } finally {
    release();
  }
}

async function runLocked(cfg: OrqConfig, opts: RunOptions, ws: Workspace, ev: ReturnType<typeof emitter>): Promise<RunResult> {
  const ctx = createContext(cfg, opts, ws, ev);
  ev.info('ORCHESTRATOR', `Lote ${cfg.lote}: ${opts.scope?.length ? `rutas ${opts.scope.join(', ')}` : 'todas las rutas'}${opts.sinRed ? ' (sin red)' : ''}`);

  // 1-2. Fuente, y lo que ya se clasificó a mano
  const { scan, scopedMaps } = await readSource(ctx);
  const { labeled, otherZones } = await loadReferences(ctx);

  // 3. Descarga (sólo lo que abarca la ejecución)
  const state = ws.loadState(cfg.fuente.url, cfg.lote);
  if (opts.soloFuente) {
    ws.saveState(state);
    return finishRun(ctx, { scan, state, dl: emptyDownload(), onlySource: true });
  }
  const dl = await downloadStage(ctx, state, scopedMaps);
  if (opts.soloDescarga) return finishRun(ctx, { scan, state, dl, onlySource: true });

  // 4-5. Análisis y clasificación (todo el lote: es el contexto para comparar y nombrar de forma estable)
  const analysis = await analyzeLote(ctx, scan, state);
  const classification = await classifyLote(ctx, scan, analysis);

  // 7-8. Comparación global, casos ya clasificados a mano, y ayuda de la IA en lo que sigue dudoso
  const zoneLabeled = labeled.files.filter((f) => f.zona.toUpperCase() === cfg.zona.toUpperCase());
  const comparison = await compareLote(ctx, classification, analysis, zoneLabeled);
  const labeledMatch = matchLabeled(ctx, zoneLabeled, comparison, classification, analysis);
  const ia = await askQwen(ctx, classification, analysis);
  const { learned, learnedVias } = learnCodes(ctx, labeledMatch);

  // 9. Nombres
  const { codes, viaCodes, routeCodes, finalName } = await nameTraces(ctx, classification, learned, learnedVias, otherZones);
  const labeledRows = labeledRowsOf(zoneLabeled, labeledMatch, finalName);

  // 10-11. Salida y estado final de cada mapa
  const { entries, rows, discardedMaps } = collectOutputs(ctx, state, analysis, classification, finalName, routeCodes);
  const salida = await writeResults(ctx, scan, entries, analysis.refOf);
  closeMapStates(ctx, scan, state, rows, discardedMaps);

  return finishRun(ctx, {
    scan,
    state,
    dl,
    pages: classification.pages,
    rows,
    traces: [...analysis.traceById.values()],
    extra: {
      ia,
      duplicados: comparison.duplicados,
      candidatos: comparison.candidatos,
      etiquetados: labeledRows,
      rutas: classification.pageOrder.map((slug) => ({ slug, ...routeCodes.get(slug)! })),
      codigosSugeridos: [...codes.sugeridos.values()],
      viasSugeridas: [...viaCodes.sugeridos.values()],
      conflictosCodigos: learned.conflicts(),
      salida,
      descargaDuplicados: dl.duplicados,
    },
    entries,
  });
}

export type { PipelineEvent };
