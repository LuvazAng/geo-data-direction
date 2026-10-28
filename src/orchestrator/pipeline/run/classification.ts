import { existsSync } from 'node:fs';
import { coloniasAlong, coloniasKml, type Coord } from '@core';
import { classifyPage, type PageResult } from '../../domain/classify';
import { pairMetrics, type Line, type PairMetrics } from '../../domain/similarity';
import { coloniaIndexFor } from '../../io/colonias';
import { loadInegi } from '../../io/inegi';
import type { SourceScan } from '../../io/source';
import type { Analysis } from './analysis';
import type { RunContext } from './context';
import { breathe, OK_SENTIDOS } from './shared';

/** Etapa 5: clasificación por subpágina (comparaciones con caché: reproducibles y sin repetir trabajo). */
export async function classifyLote(ctx: RunContext, scan: SourceScan, { analyzed, refOf }: Analysis) {
  const { cfg, ev } = ctx;
  const places = await ctx.stage('clasificacion', () => loadInegi(cfg.dirs.inegi));
  // Colonias del INE para el campo COLONIAS de cada KML; si no se pueden leer, se genera sin él
  const hasColonias = existsSync(cfg.dirs.colonias);
  if (!hasColonias) ctx.advertencias.push(`Sin colonias: no existe ${cfg.dirs.colonias}; los KML salen sin el campo COLONIAS (npm run colonias las prepara)`);
  const colonias = hasColonias
    ? await ctx.stage('clasificacion', () => {
        try {
          return coloniaIndexFor(cfg.dirs.colonias);
        } catch (e) {
          ctx.errores.push(`Colonias (${cfg.dirs.colonias}): ${(e as Error).message}`);
          return undefined;
        }
      })
    : undefined;
  const coloniasDe = (coords: Coord[]) => colonias && coloniasKml(coloniasAlong(coords, colonias));
  const simCache = new Map<string, PairMetrics>();
  const sim = (a: Line, b: Line): PairMetrics => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let m = simCache.get(key);
    if (!m) simCache.set(key, (m = a.id < b.id ? pairMetrics(a, b, cfg.similitud) : pairMetrics(b, a, cfg.similitud)));
    // calculado como (b, a): se devuelve en el orden pedido
    return m.a === a.id
      ? m
      : {
          ...m,
          a: a.id,
          b: b.id,
          coberturaAB: m.coberturaBA,
          coberturaBA: m.coberturaAB,
          extremos: { startStart: m.extremos.startStart, startEnd: m.extremos.endStart, endStart: m.extremos.startEnd, endEnd: m.extremos.endEnd },
        };
  };
  const pageOrder = [...new Set(scan.maps.map((m) => m.pageSlug))];
  const pages: PageResult[] = await ctx.stage('clasificacion', async () => {
    const out: PageResult[] = [];
    for (const p of pageOrder.map((slug) => ({ slug, maps: analyzed.filter((a) => a.ref.pageSlug === slug) })).filter((x) => x.maps.length)) {
      await breathe();
      const r = classifyPage({ slug: p.slug, title: p.maps[0].ref.pageTitle, maps: p.maps.map(({ ref, data }) => ({ ref, data })) }, cfg, places, sim);
      if (ctx.inScope(p.slug)) {
        const pr = r.decisions.filter((d) => d.role === 'principal' && !d.duplicadoDe);
        const ok = pr.filter((d) => OK_SENTIDOS.has(d.sentido) && d.revision.length === 0).length;
        ev.info(
          'CLASSIFY',
          `${r.duplas.length} dupla(s), ${pr.length} itinerario(s): ${ok} con sentido confirmado, ${pr.length - ok} dudoso(s)${r.hub ? ` · terminal ${r.hub}` : ''}`,
          { ruta: p.slug },
        );
        for (const d of pr.filter((x) => x.revision.length)) {
          ev.warn('CLASSIFY', `${refOf.get(d.mapId)?.title} #${d.index}: ${d.revision.join('; ')}`, { ruta: p.slug, mapa: d.mapId });
        }
      }
      out.push(r);
    }
    return out;
  });
  const decisions = pages.flatMap((p) => p.decisions);
  const decById = new Map(decisions.map((d) => [d.traceId, d]));
  const pageOf = new Map(pages.flatMap((p) => p.decisions.map((d) => [d.traceId, p] as const)));
  return { places, colonias, coloniasDe, sim, pageOrder, pages, decisions, decById, pageOf };
}

export type Classification = Awaited<ReturnType<typeof classifyLote>>;
