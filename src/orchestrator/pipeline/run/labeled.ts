import type { TraceDecision } from '../../domain/classify';
import { LearnedCodes, type LabeledFile } from '../../domain/labeled';
import { abbreviates } from '../../domain/places';
import type { PairMetrics } from '../../domain/similarity';
import type { Report } from '../report';
import type { Analysis } from './analysis';
import type { Classification } from './classification';
import type { Comparison } from './comparison';
import type { RunContext } from './context';
import { isOk, OK_SENTIDOS } from './shared';
import type { Validation } from './types';

/** Un archivo ya clasificado a mano y el trazo de la fuente que lo equivale. */
export type LabeledMatch = Map<string, { file: LabeledFile; m: PairMetrics; dec: TraceDecision; validacion: Validation }>;

/**
 * Etapa 8: casos etiquetados (GEODATA/RUTAS): validación independiente del orquestador contra el nombre
 * que le puso el usuario, y evidencia para los casos que no tenían ninguna.
 */
export function matchLabeled(
  ctx: RunContext,
  zoneLabeled: LabeledFile[],
  comparison: Comparison,
  { decById }: Pick<Classification, 'decById'>,
  { refOf }: Pick<Analysis, 'refOf'>,
): LabeledMatch {
  const { ev } = ctx;
  const labeledMatch: LabeledMatch = new Map();
  for (const f of zoneLabeled) {
    const ms = (comparison.vsLabeled.get(f.id) ?? []).sort((x, y) => y.similitud - x.similitud);
    const best = ms.find((m) => m.sentido === 'mismo' && m.similitud >= 0.8) ?? ms.find((m) => m.sentido === 'mismo') ?? ms.find((m) => m.similitud >= 0.8);
    if (!best) continue;
    const dec = decById.get(best.b)!;
    // Validación independiente: lo que decidió el orquestador (sin mirar este archivo) contra el
    // nombre que le puso el usuario. El código se compara como abreviatura (IXT ~ PUENTE DE IXTLA).
    let validacion: Validation = 'sin-decision';
    if (OK_SENTIDOS.has(dec.sentido) && dec.origen && dec.destino && f.parsed) {
      const [o, d] = best.sentido === 'mismo' ? [dec.origen, dec.destino] : [dec.destino, dec.origen];
      if (abbreviates(f.parsed.origen, o) && abbreviates(f.parsed.destino, d)) validacion = best.sentido === 'mismo' ? 'coincide' : 'difiere';
      else if (abbreviates(f.parsed.origen, d) && abbreviates(f.parsed.destino, o)) validacion = 'difiere';
      else validacion = 'no-verificable';
    }
    labeledMatch.set(f.id, { file: f, m: best, dec, validacion });
  }
  for (const { file, m, dec, validacion } of labeledMatch.values()) {
    if (validacion === 'difiere') dec.revision.push(`difiere de la clasificación existente ${file.rel}`);
    // Sin evidencia propia: la clasificación que ya hizo el usuario sirve de evidencia
    if (dec.sentido === 'sin-evidencia' && dec.origen && dec.destino && file.parsed && m.similitud >= 0.8 && dec.role === 'principal') {
      const fwd = abbreviates(file.parsed.origen, dec.origen) && abbreviates(file.parsed.destino, dec.destino);
      const back = abbreviates(file.parsed.origen, dec.destino) && abbreviates(file.parsed.destino, dec.origen);
      if (fwd !== back) {
        // mismo orden de coordenadas y nombre en el mismo orden → el archivo va de origen a destino
        const peso = (fwd ? 3 : -3) * (m.sentido === 'mismo' ? 1 : -1);
        dec.evidencias.push({
          fuente: 'existente',
          peso,
          detalle: `${file.rel} (ya clasificado) ${peso > 0 ? 'lo confirma' : 'lo tiene al revés'} (similitud ${m.similitud})`,
        });
        dec.sentido = peso > 0 ? 'confirmado' : 'contrario';
        dec.puntaje += peso;
        dec.revision = dec.revision.filter((r) => !/ningún extremo/.test(r));
        if (peso < 0) dec.revision.push(`${file.rel} (ya clasificado) va al revés de su DESCRIPCIO`);
        const ref = refOf.get(dec.mapId)!;
        if (ctx.inScope(ref.pageSlug)) {
          ev.info(
            'CLASSIFY',
            `${ref.title} #${dec.index}: sin evidencia propia; se toma el sentido de ${file.rel} (${peso > 0 ? 'lo confirma' : 'lo contradice'})`,
            { ruta: ref.pageSlug, mapa: dec.mapId },
          );
        }
      }
    }
  }
  return labeledMatch;
}

/** Códigos de lugares y de vías que se aprenden de lo que el usuario ya nombró; se guardan en el lote. */
export function learnCodes(ctx: RunContext, labeledMatch: LabeledMatch) {
  const alias = ctx.cfg.nomenclatura.alias;
  const learned = new LearnedCodes();
  const learnedVias = new LearnedCodes();
  for (const { file, m, dec } of labeledMatch.values()) {
    if (m.sentido !== 'mismo' || !file.parsed || !dec.origen || !dec.destino || !OK_SENTIDOS.has(dec.sentido)) continue;
    learned.add(dec.origen, file.parsed.origen, file.rel, alias);
    learned.add(dec.destino, file.parsed.destino, file.rel, alias);
    if (file.parsed.via && dec.via) learnedVias.add(dec.via, file.parsed.via, file.rel, alias);
  }
  ctx.ws.writeJson(['catalogo-aprendido.json'], { localidades: learned.toJSON(), vias: learnedVias.toJSON() });
  return { learned, learnedVias };
}

/** Comparación, archivo por archivo, entre lo que se generó y lo que el usuario ya había clasificado. */
export function labeledRowsOf(
  zoneLabeled: LabeledFile[],
  labeledMatch: LabeledMatch,
  finalName: Map<string, { nombre: string }>,
): Report['etiquetados']['detalle'] {
  const labeledRows: Report['etiquetados']['detalle'] = [];
  for (const f of zoneLabeled) {
    const lm = labeledMatch.get(f.id);
    if (!lm) {
      labeledRows.push({
        archivo: f.rel,
        traza: null,
        similitud: null,
        sentido: null,
        nombreGenerado: null,
        coincideSentido: null,
        coincideNombre: null,
        validacion: 'sin-equivalente',
        nota: 'sin trazo equivalente en la fuente',
      });
      continue;
    }
    const name = finalName.get(lm.dec.traceId)?.nombre ?? null;
    const gen = isOk(lm.dec) ? name : null;
    const strip = (n: string) => n.split('-').slice(1).join('-');
    const notes = [
      name && f.parsed && name.split('-')[0] !== f.parsed.ruta ? `código de ruta: ${f.parsed.ruta} → ${name.split('-')[0]}` : '',
      !gen && name ? `en revisión (propuesto ${name})` : '',
      lm.dec.evidencias.some((e) => e.fuente === 'existente') ? 'sentido tomado de este archivo (no cuenta en la validación)' : '',
    ];
    labeledRows.push({
      archivo: f.rel,
      traza: lm.dec.traceId,
      similitud: lm.m.similitud,
      sentido: lm.m.sentido,
      nombreGenerado: gen,
      coincideSentido: lm.validacion === 'coincide' ? true : lm.validacion === 'difiere' ? false : null,
      coincideNombre: gen ? strip(gen).replace(/-\d+$/, '') === strip(f.nombre) : null,
      validacion: lm.validacion,
      nota: notes.filter(Boolean).join('; '),
    });
  }
  return labeledRows;
}
