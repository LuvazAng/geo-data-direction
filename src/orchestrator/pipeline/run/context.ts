import type { emitter, Stage } from '@protocol';
import type { OrqConfig } from '../../config';
import { HttpClient } from '../../io/http';
import type { Workspace } from '../../io/store';
import type { RunOptions } from './types';

/** Lo que comparten todas las etapas de una ejecución. */
export interface RunContext {
  cfg: OrqConfig;
  opts: RunOptions;
  ws: Workspace;
  ev: ReturnType<typeof emitter>;
  http: HttpClient;
  started: Date;
  /** Milisegundos que tomó cada etapa. */
  tiempos: Record<string, number>;
  errores: string[];
  advertencias: string[];
  /** Subpáginas (rutas) que abarca la ejecución; null = todas. Se fija al leer la fuente. */
  scope: Set<string> | null;
  inScope: (slug: string) => boolean;
  /** Corre una etapa: avisa, mide su tiempo y revisa la cancelación antes de empezar. */
  stage: <T>(name: Stage, fn: () => Promise<T> | T) => Promise<T>;
}

export function createContext(cfg: OrqConfig, opts: RunOptions, ws: Workspace, ev: ReturnType<typeof emitter>): RunContext {
  const ctx: RunContext = {
    cfg,
    opts,
    ws,
    ev,
    http: opts.http ?? new HttpClient(cfg.fuente),
    started: new Date(),
    tiempos: {},
    errores: [],
    advertencias: [],
    scope: null,
    inScope: (slug) => !ctx.scope || ctx.scope.has(slug),
    stage: async (name, fn) => {
      opts.signal?.throwIfAborted();
      ev.stage(name);
      const t = Date.now();
      try {
        return await fn();
      } finally {
        ctx.tiempos[name] = (ctx.tiempos[name] ?? 0) + Date.now() - t;
      }
    },
  };
  return ctx;
}

/** El alcance se resuelve contra las subpáginas conocidas: "ruta-1-sur" exacto, o una parte ("2", "ctm"). */
export function resolveScope(ctx: RunContext, pages: { slug: string }[]): Set<string> | null {
  if (!ctx.opts.scope?.length) return null;
  const out = new Set<string>();
  for (const want of ctx.opts.scope) {
    const exact = pages.find((p) => p.slug === want);
    const partial = pages.filter((p) => p.slug.toLowerCase().includes(want.toLowerCase()));
    const hits = exact ? [exact] : partial;
    if (hits.length === 0) throw new Error(`La ruta «${want}» no está en la fuente de ${ctx.cfg.lote}`);
    hits.forEach((p) => out.add(p.slug));
  }
  return out;
}
