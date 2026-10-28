import type { TraceDecision } from '../../domain/classify';
import type { LearnedCodes } from '../../domain/labeled';
import { CodeBook, fillPattern, routeCodeFor, type RouteCode } from '../../domain/naming';
import { samePlace } from '../../domain/places';
import { safeName } from '../../io/store';
import type { CodeSource } from '@protocol';
import type { Classification } from './classification';
import type { RunContext } from './context';

/** Nombre de salida de un trazo: el nombre del KML, su ruta relativa y de dónde salió cada código. */
export type FinalName = { nombre: string; archivo: string; codigos: Record<string, CodeSource | null> };

/**
 * Etapa 9: nombres de todo el lote, en el mismo orden siempre (los códigos sugeridos no dependen del
 * alcance de la ejecución). Cuando algo no se puede nombrar, el trazo queda con un motivo de revisión.
 */
export async function nameTraces(
  ctx: RunContext,
  { pages, decisions, decById, pageOrder }: Pick<Classification, 'pages' | 'decisions' | 'decById' | 'pageOrder'>,
  learned: LearnedCodes,
  learnedVias: LearnedCodes,
  otherZones: { numbers: Set<string>; codes: Set<string> },
) {
  const { cfg } = ctx;
  const alias = cfg.nomenclatura.alias;
  const codes = new CodeBook(cfg.nomenclatura.localidades, learned.winners(), cfg.nomenclatura.codigoNuevo, alias);
  const viaCodes = new CodeBook(cfg.nomenclatura.vias, learnedVias.winners(), cfg.nomenclatura.codigoNuevo, alias);
  const routeCodes = new Map<string, RouteCode>(pageOrder.map((slug) => [slug, routeCodeFor(slug, pageOrder, cfg, otherZones)]));
  const finalName = new Map<string, FinalName>();
  await ctx.stage('nombres', () => {
    const usedPaths = new Set<string>();
    // Dentro de un mapa, un lugar escrito de dos formas ("SAN MIGUEL" / "SAN MIGUEL 30") usa el nombre más completo
    const canonical = new Map<string, (n: string) => string>();
    for (const mapId of new Set(decisions.map((d) => d.assignedMapId))) {
      const names = [
        ...new Set(
          decisions
            .filter((d) => d.assignedMapId === mapId && d.role === 'principal')
            .flatMap((d) => [d.origen, d.destino])
            .filter(Boolean) as string[],
        ),
      ].sort((a, b) => b.length - a.length);
      canonical.set(mapId, (n) => names.find((m) => samePlace(m, n, alias)) ?? n);
    }
    for (const page of pages) {
      const rc = routeCodes.get(page.slug)!;
      const codeOf = (d: TraceDecision, n: string) => codes.codeFor(canonical.get(d.assignedMapId)!(n));
      const pairKey = (d: TraceDecision) => [codeOf(d, d.origen!).codigo, codeOf(d, d.destino!).codigo].sort().join('|');
      const perKey = new Map<string, Set<string>>();
      for (const d of page.decisions.filter((x) => x.role === 'principal' && !x.duplicadoDe && x.origen && x.destino)) {
        (perKey.get(pairKey(d)) ?? perKey.set(pairKey(d), new Set()).get(pairKey(d))!).add(d.dupla ?? d.traceId);
      }
      for (const dupla of page.duplas) {
        for (const id of dupla.traces) {
          const d = decById.get(id)!;
          if (!d.origen || !d.destino) continue;
          const o = codeOf(d, d.origen);
          const de = codeOf(d, d.destino);
          const viaText = d.via ?? (dupla.variante || null);
          const wantVia = !!viaText && (cfg.nomenclatura.incluirVia === 'siempre' || (perKey.get(pairKey(d))?.size ?? 0) > 1);
          const v = wantVia ? viaCodes.codeFor(viaText!) : { codigo: null, origen: null };
          if (!o.codigo || !de.codigo || (wantVia && !v.codigo)) {
            d.revision.push(
              `sin código para ${[!o.codigo && d.origen, !de.codigo && d.destino, wantVia && !v.codigo && viaText].filter(Boolean).join(', ')} (nomenclatura.codigoNuevo = revision)`,
            );
            continue;
          }
          let nombre = fillPattern(cfg.nomenclatura.patron, { ruta: rc.codigo, origen: o.codigo, destino: de.codigo, via: v.codigo });
          const dir = `${safeName(cfg.zona.toUpperCase())}/${safeName(rc.carpeta)}/${dupla.n}`;
          let archivo = `${dir}/${nombre}.kml`;
          if (usedPaths.has(archivo.toUpperCase())) {
            if (cfg.nomenclatura.colision === 'revision') {
              d.revision.push(`el nombre ${nombre} ya lo usa otro trazo (nomenclatura.colision = revision)`);
              continue;
            }
            const base = nombre;
            for (let k = 2; usedPaths.has(archivo.toUpperCase()); k++) {
              nombre = `${base}-${k}`;
              archivo = `${dir}/${nombre}.kml`;
            }
            d.evidencias.push({ fuente: 'titulo', peso: 0, detalle: `nombre repetido: se agregó el sufijo ${nombre.slice(base.length)}` });
          }
          usedPaths.add(archivo.toUpperCase());
          finalName.set(id, { nombre, archivo, codigos: { ruta: rc.origen, origen: o.origen, destino: de.origen, via: v.origen } });
        }
      }
    }
  });
  return { codes, viaCodes, routeCodes, finalName };
}
