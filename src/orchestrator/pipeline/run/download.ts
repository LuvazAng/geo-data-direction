import { downloadMaps, type DownloadSummary } from '../../io/download';
import type { MapRef } from '../../io/source';
import type { BatchState } from '../../io/store';
import type { RunContext } from './context';

const HINT_403 =
  ' — el mapa se puede ver, pero su dueño no permite exportarlo; hace falta que habilite la descarga o un acceso autorizado (no se intentó evadir)';

export const emptyDownload = (): DownloadSummary => ({ descargados: 0, yaEstaban: 0, errores: 0, duplicados: [] });

/** Etapa 3: descarga sólo lo que abarca la ejecución (nada si es sin red) y guarda el estado de los mapas. */
export async function downloadStage(ctx: RunContext, state: BatchState, scopedMaps: MapRef[]): Promise<DownloadSummary> {
  const { cfg, opts, ws, ev, http } = ctx;
  let dl = emptyDownload();
  if (!opts.sinRed) {
    dl = await ctx.stage('descarga', async () => {
      ev.info('DOWNLOAD', `${scopedMaps.length} mapa(s) por revisar`);
      const r = await downloadMaps(scopedMaps, state, ws, http, cfg.fuente.maxBytes, { refrescar: opts.refrescar, emit: ev.emit, signal: opts.signal });
      ev.info('DOWNLOAD', `Descargados ${r.descargados}, ya estaban ${r.yaEstaban}, errores ${r.errores}`);
      return r;
    });
  }
  for (const m of Object.values(state.mapas)) {
    if (m.estado === 'ERROR' && /HTTP 403/.test(m.error ?? '') && /maps\/d\/kml/.test(m.downloadUrl)) {
      m.error = m.error!.split(HINT_403)[0] + HINT_403;
    }
  }
  ws.saveState(state);
  return dl;
}
