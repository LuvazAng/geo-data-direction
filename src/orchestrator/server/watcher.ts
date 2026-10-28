import { watch, type FSWatcher } from 'node:fs';
import type { LoteInfo } from '../config';
import { folderOf } from '../domain/naming';
import { Workspace } from '../io/store';
import type { EventHub } from './hub';
import type { JobManager } from './jobs';
import type { LogService } from './logs';
import { loteData } from './views';

interface WatchDeps {
  jobs: JobManager;
  logs: LogService;
  hub: EventHub;
  refreshRoutes: (lote: string) => void;
}

/** Observa las carpetas de los lotes: cualquier cambio (del orquestador o hecho a mano) llega al navegador. */
export function watchLotes(lotes: LoteInfo[], { jobs, logs, hub, refreshRoutes }: WatchDeps): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const l of lotes) {
    try {
      new Workspace(l.config.dirs.trabajo, l.config.lote); // crea la carpeta si falta
      const pending = new Set<string>();
      let timer: NodeJS.Timeout | undefined;
      const w = watch(l.raiz, { recursive: true }, (_ev, file) => {
        const rel = String(file ?? '').replace(/\\/g, '/');
        if (!rel || rel.endsWith('.tmp') || rel === '.lock' || rel.startsWith('ejecuciones/')) return;
        pending.add(rel);
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          const changed = [...pending];
          pending.clear();
          const rutas = slugsFor(l, changed);
          const running = jobs.runningJobs().some((j) => j.lote === l.lote);
          logs.add({
            nivel: running ? 'DEBUG' : 'INFO',
            componente: 'FS',
            mensaje: `${changed.length} cambio(s) en ${l.lote}: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '…' : ''}`,
            lote: l.lote,
          });
          hub.publish({ type: 'folder.updated', data: { lote: l.lote, rutas, motivo: running ? 'ejecución en curso' : 'cambio en disco' } });
          refreshRoutes(l.lote);
        }, 400);
      });
      w.on('error', (e) => logs.add({ nivel: 'WARN', componente: 'FS', mensaje: `Se dejó de observar ${l.lote}: ${e.message}`, lote: l.lote }));
      watchers.push(w);
    } catch (e) {
      logs.add({ nivel: 'WARN', componente: 'FS', mensaje: `No se pudo observar la carpeta de ${l.lote}: ${(e as Error).message}`, lote: l.lote });
    }
  }
  return watchers;
}

function slugsFor(l: LoteInfo, rels: string[]): string[] {
  const { scan, state } = loteData(l);
  if (!scan) return [];
  const out = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split('/');
    if (parts[0] === 'originales') {
      const m = Object.values(state?.mapas ?? {}).find((x) => x.archivo === parts[1]);
      if (m) out.add(m.pageSlug);
    } else if (parts[0] === 'resultados' && parts[2]) {
      const page = scan.pages.find((p) => folderOf(p.slug) === parts[2]);
      if (page) out.add(page.slug);
    }
  }
  return [...out];
}
