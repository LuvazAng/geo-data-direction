import { meters } from '@core';
import type { LabeledFile } from '../../domain/labeled';
import { candidatePairs, type Line, type PairMetrics } from '../../domain/similarity';
import type { Analysis } from './analysis';
import type { Classification } from './classification';
import type { RunContext } from './context';
import { breathe } from './shared';

/**
 * Etapa 7: comparación global: posibles duplicados entre mapas y contra los archivos ya clasificados.
 * Antes del cálculo detallado se descartan pares que no pueden ser el mismo recorrido
 * (longitudes muy distintas o extremos lejanos en ambos sentidos).
 */
export async function compareLote(
  ctx: RunContext,
  { decisions, sim }: Pick<Classification, 'decisions' | 'sim'>,
  { traceById, refOf }: Pick<Analysis, 'traceById' | 'refOf'>,
  zoneLabeled: LabeledFile[],
) {
  const { cfg, ev } = ctx;
  return ctx.stage('comparacion', async () => {
    const t0 = Date.now();
    const principals = decisions.filter((d) => d.role === 'principal' && !d.duplicadoDe).map((d) => traceById.get(d.traceId)!);
    const lines: Line[] = [...principals, ...zoneLabeled];
    const plausible = (a: Line, b: Line) => {
      if (Math.min(a.lengthM, b.lengthM) / Math.max(a.lengthM, b.lengthM) < 0.8) return false;
      const tol = Math.max(300, 0.05 * Math.min(a.lengthM, b.lengthM));
      const [as, ae, bs, be] = [a.coords[0], a.coords[a.coords.length - 1], b.coords[0], b.coords[b.coords.length - 1]];
      return (meters(as, bs) <= tol && meters(ae, be) <= tol) || (meters(as, be) <= tol && meters(ae, bs) <= tol);
    };
    const pairs = candidatePairs(lines, cfg.similitud.celdaM, cfg.similitud.candidatoMin).filter(([a, b]) => plausible(a, b));
    const duplicados: PairMetrics[] = [];
    const vsLabeled = new Map<string, PairMetrics[]>();
    let k = 0;
    for (const [a, b] of pairs) {
      if (++k % 20 === 0) await breathe();
      const la = a.id.startsWith('etiquetado:');
      const lb = b.id.startsWith('etiquetado:');
      if (la && lb) continue;
      if (la || lb) {
        const [lab, tr] = la ? [a, b] : [b, a];
        const m = sim(lab, tr);
        if (m.similitud >= 0.6) (vsLabeled.get(lab.id) ?? vsLabeled.set(lab.id, []).get(lab.id)!).push(m);
        continue;
      }
      if (traceById.get(a.id)!.mapId === traceById.get(b.id)!.mapId) continue;
      const m = sim(a, b);
      if (['identico', 'identico-invertido', 'casi-identico', 'casi-identico-invertido'].includes(m.clase)) duplicados.push(m);
    }
    ev.info('GEOMETRY', `Similitud: ${pairs.length} par(es) plausibles comparados, ${duplicados.length} posible(s) duplicado(s) entre mapas`, {
      duracionMs: Date.now() - t0,
    });
    for (const d of duplicados.filter(
      (x) => ctx.inScope(refOf.get(traceById.get(x.a)!.mapId)!.pageSlug) || ctx.inScope(refOf.get(traceById.get(x.b)!.mapId)!.pageSlug),
    )) {
      const ra = refOf.get(traceById.get(d.a)!.mapId)!;
      const rb = refOf.get(traceById.get(d.b)!.mapId)!;
      ev.info('GEOMETRY', `${d.clase} (${Math.round(d.similitud * 100)} %): ${ra.pageSlug} «${ra.title}» ↔ ${rb.pageSlug} «${rb.title}»`, {
        ruta: ra.pageSlug,
      });
    }
    return { duplicados, vsLabeled, candidatos: pairs.length };
  });
}

export type Comparison = Awaited<ReturnType<typeof compareLote>>;
