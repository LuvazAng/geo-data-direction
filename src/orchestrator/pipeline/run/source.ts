import { existsSync } from 'node:fs';
import { loadLabeled, routeCodesByZone, routeNumbersByZone } from '../../domain/labeled';
import { rescanPages, scanSource, zoneSlugs, type MapRef, type SourceScan } from '../../io/source';
import { resolveScope, type RunContext } from './context';

/** Etapa 1: la fuente (subpáginas y mapas), del sitio o de lo guardado en la corrida anterior. */
export async function readSource(ctx: RunContext): Promise<{ scan: SourceScan; scopedMaps: MapRef[] }> {
  const { cfg, opts, ws, ev, http } = ctx;
  const scan = await ctx.stage('fuente', async (): Promise<SourceScan> => {
    const cached = ws.readJson<SourceScan | null>(['fuente.json'], null);
    const onPage = (p: { slug: string; status: string; maps: number; error?: string }) =>
      p.status === 'ok' ? ev.info('SOURCE', `${p.slug}: ${p.maps} mapa(s)`, { ruta: p.slug }) : ev.error('SOURCE', `${p.slug}: ${p.error}`, { ruta: p.slug });
    if (opts.sinRed) {
      if (!cached) throw new Error('Sin red: no hay fuente.json de una corrida anterior');
      ev.info('SOURCE', `Fuente guardada el ${cached.escaneadoEn}: ${cached.pages.length} subpágina(s), ${cached.maps.length} mapa(s)`);
      ctx.scope = resolveScope(ctx, cached.pages);
      return cached;
    }
    if (opts.scope?.length && cached && !opts.soloFuente) {
      ctx.scope = resolveScope(ctx, cached.pages);
      ev.info('SOURCE', `Revisando ${ctx.scope!.size} subpágina(s) en ${cfg.fuente.url}`);
      const s = await rescanPages(cfg, http, cached, [...ctx.scope!], onPage);
      ws.writeJson(['fuente.json'], s);
      return s;
    }
    ev.info('SOURCE', `Leyendo ${cfg.fuente.url}`);
    const s = await scanSource(cfg, http, onPage);
    ws.writeJson(['fuente.json'], s);
    ev.info('SOURCE', `${s.pages.length} subpágina(s), ${s.maps.length} mapa(s)`);
    ctx.scope = resolveScope(ctx, s.pages);
    return s;
  });
  for (const d of scan.diagnostics) {
    ev.warn('SOURCE', d);
    ctx.advertencias.push(d);
  }
  const scopedMaps = scan.maps.filter((m) => ctx.inScope(m.pageSlug));
  for (const m of scopedMaps) ev.file('detectado', m.pageSlug, { mapa: m.id, detalle: m.title });
  return { scan, scopedMaps };
}

/** Etapa 2: archivos ya clasificados a mano y números de ruta de las otras zonas. */
export async function loadReferences(ctx: RunContext) {
  const { cfg, opts, ws, ev, http } = ctx;
  // Los casos ya clasificados son opcionales: sin la carpeta se clasifica sin compararlos ni aprender códigos
  if (!existsSync(cfg.dirs.existentes)) ctx.advertencias.push(`Sin casos etiquetados: no existe ${cfg.dirs.existentes} (opcional; ver data/README.md)`);
  const labeled = await ctx.stage('fuente', () => (existsSync(cfg.dirs.existentes) ? loadLabeled(cfg.dirs.existentes) : { files: [], errores: [] }));
  ctx.errores.push(...labeled.errores.map((e) => `Casos etiquetados: ${e}`));
  const otherZones = await ctx.stage('fuente', async () => {
    const numbers = new Set<string>();
    const codes = new Set<string>();
    for (const [zona, set] of routeNumbersByZone(labeled.files)) if (zona !== cfg.zona) set.forEach((n) => numbers.add(n));
    for (const [zona, set] of routeCodesByZone(labeled.files)) if (zona !== cfg.zona) set.forEach((c) => codes.add(c));
    const cached = ws.readJson<Record<string, string[]>>(['zonas-referencia.json'], {});
    for (const url of cfg.fuente.zonasReferencia) {
      // En una ejecución por ruta basta lo guardado: no se recorren otras zonas cada vez
      if (!opts.sinRed && (!ctx.scope || !cached[url])) {
        try {
          cached[url] = await zoneSlugs(http, url);
        } catch (e) {
          ctx.errores.push(`Zona de referencia ${url}: ${(e as Error).message}`);
          ev.warn('SOURCE', `Zona de referencia ${url}: ${(e as Error).message}`);
        }
      }
      for (const s of cached[url] ?? []) {
        const m = /^ruta-(\d+)/.exec(s.toLowerCase());
        if (m) numbers.add(String(Number(m[1])));
      }
    }
    ws.writeJson(['zonas-referencia.json'], cached);
    return { numbers, codes };
  });
  return { labeled, otherZones };
}
