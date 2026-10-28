import { reevaluate, relevantHits, type PageResult, type TraceDecision } from '../../domain/classify';
import { samePlace } from '../../domain/places';
import type { TraceInfo } from '../../domain/traces';
import type { MapRef } from '../../io/source';
import { QwenClient, type MapAnswer, type MapQuestion } from '../../llm/llm';
import type { Report } from '../report';
import type { Analysis } from './analysis';
import type { Classification } from './classification';
import type { RunContext } from './context';
import { OK_SENTIDOS } from './shared';

/** Un itinerario principal sin origen o sin sentido confiable: lo único con lo que Qwen puede ayudar. */
const needsHelp = (d: TraceDecision) => d.role === 'principal' && !d.duplicadoDe && (!d.origen || !OK_SENTIDOS.has(d.sentido));

/**
 * Qwen: sólo los mapas cuyos principales siguen dudosos. En una ejecución por ruta, los de otras
 * rutas sólo usan respuestas ya guardadas (no se consulta al modelo por ellos). La IA propone nombres:
 * se aceptan únicamente si la geometría los confirma sin contradicción.
 */
export async function askQwen(
  ctx: RunContext,
  { decisions, pages, places }: Pick<Classification, 'decisions' | 'pages' | 'places'>,
  { refOf, traceById, analyzed }: Pick<Analysis, 'refOf' | 'traceById' | 'analyzed'>,
) {
  const { cfg, opts, ws, ev } = ctx;
  const ia = {
    habilitada: cfg.ia.habilitada,
    disponible: false,
    detalle: 'deshabilitada (--sin-ia o ia.habilitada = false)',
    consultas: 0,
    enCache: 0,
    aplicadas: 0,
    errores: 0,
    intervenciones: [] as Report['ia']['intervenciones'],
  };
  if (cfg.ia.habilitada) {
    await ctx.stage('ia', async () => {
      const cache = ws.readJson<Record<string, MapAnswer>>(['ia-cache.json'], {});
      const qwen = opts.qwen ?? new QwenClient(cfg.ia, { get: (k) => cache[k], set: (k, v) => (cache[k] = v) });
      const maps = [...new Set(decisions.filter(needsHelp).map((d) => d.assignedMapId))];
      const live = maps.filter((id) => ctx.inScope(refOf.get(id)!.pageSlug));
      if (live.length) {
        const av = await qwen.available();
        Object.assign(ia, { disponible: av.ok, detalle: av.detalle });
        if (!av.ok) {
          ev.warn('QWEN', `${av.detalle} — se continúa sin IA`);
          ctx.advertencias.push(av.detalle);
        } else ev.info('QWEN', `${live.length} mapa(s) con casos dudosos → ${cfg.ia.modelo}`);
      } else Object.assign(ia, { disponible: true, detalle: `${cfg.ia.modelo}: sin casos dudosos en esta ejecución` });
      for (const mapId of maps) {
        opts.signal?.throwIfAborted();
        const ref = refOf.get(mapId)!;
        const isLive = ctx.inScope(ref.pageSlug) && ia.disponible;
        const page = pages.find((p) => p.decisions.some((d) => d.assignedMapId === mapId))!;
        const decs = page.decisions.filter((d) => d.assignedMapId === mapId && (d.role === 'principal' || d.role === 'otro') && !d.duplicadoDe);
        const q = question(mapId, page, decs, refOf, traceById, analyzed.find((a) => a.ref.id === mapId)?.data.docName ?? '');
        if (isLive) {
          ev.info('QWEN', `Solicitud: interpretar «${ref.title}» (${q.trazos.length} trazo(s), ${q.candidatos.length} lugar(es) candidatos)`, {
            ruta: ref.pageSlug,
            mapa: mapId,
            datos: { tarea: 'origen/destino/vía/rol por trazo', candidatos: q.candidatos },
          });
        }
        const r = await qwen.interpretMap(q, { soloCache: !isLive });
        if (!isLive && !r.cached) continue;
        ia.consultas++;
        if (r.cached) ia.enCache++;
        const cambios: string[] = [];
        if (!r.answer) {
          ia.errores++;
          ia.intervenciones.push({
            mapa: mapId,
            titulo: ref.title,
            ms: r.ms,
            enCache: r.cached,
            error: r.error,
            descartes: r.descartes,
            cambios,
            explicacion: '',
          });
          ev.error('QWEN', `«${ref.title}»: ${r.error}`, { ruta: ref.pageSlug, mapa: mapId, duracionMs: r.ms });
          continue;
        }
        for (const a of r.answer.trazos) {
          const dec = decs[a.indice];
          if (!dec || !needsHelp(dec) || !a.origen || !a.destino || samePlace(a.origen, a.destino)) continue;
          const t = traceById.get(dec.traceId)!;
          const re = reevaluate(dec, t, a.origen, a.destino, page, cfg, places);
          // La IA sólo propone nombres; se aceptan si la geometría los confirma sin contradicción
          if (OK_SENTIDOS.has(re.sentido) && re.puntaje > 0) {
            const antes = `${dec.origen ?? '?'}→${dec.destino ?? '?'} (${dec.sentido})`;
            Object.assign(dec, { origen: a.origen, destino: a.destino, fuenteNombres: 'ia' as const, sentido: re.sentido, puntaje: re.puntaje });
            dec.evidencias = [
              ...dec.evidencias.filter((e) => e.peso === 0),
              { fuente: 'ia', peso: 0, detalle: `Qwen propuso ${a.origen}→${a.destino} (confianza ${a.confianza})` },
              ...re.evidencias,
            ];
            dec.revision = dec.revision.filter((m) => !/sentido|origen y el destino|ningún extremo/.test(m));
            if (a.via && !dec.via) dec.via = a.via;
            cambios.push(`trazo ${a.indice}: ${antes} → ${a.origen}→${a.destino} (${re.sentido}, confirmado por la geometría)`);
            ia.aplicadas++;
          } else {
            cambios.push(`trazo ${a.indice}: propuesta ${a.origen}→${a.destino} descartada (la geometría da «${re.sentido}»)`);
          }
        }
        for (const d of decs.filter(needsHelp)) d.evidencias.push({ fuente: 'ia', peso: 0, detalle: `Qwen: ${r.answer.explicacion}` });
        ia.intervenciones.push({
          mapa: mapId,
          titulo: ref.title,
          ms: r.ms,
          enCache: r.cached,
          descartes: r.descartes,
          cambios,
          explicacion: r.answer.explicacion,
        });
        if (isLive || ctx.inScope(ref.pageSlug)) {
          ev.info('QWEN', `Respuesta${r.cached ? ' (caché)' : ''} para «${ref.title}»: ${cambios.length ? cambios.join('; ') : 'sin cambios'}`, {
            ruta: ref.pageSlug,
            mapa: mapId,
            duracionMs: r.ms,
            datos: { respuesta: r.answer, descartes: r.descartes },
          });
        }
      }
      ws.writeJson(['ia-cache.json'], cache);
    });
  }
  return ia;
}

/** La pregunta que se le hace a Qwen sobre un mapa: sus trazos, los lugares candidatos y lo decidido hasta ahora. */
function question(
  mapId: string,
  page: PageResult,
  decs: TraceDecision[],
  refOf: Map<string, MapRef>,
  traces: Map<string, TraceInfo>,
  docName: string,
): MapQuestion {
  const ref = refOf.get(mapId)!;
  const names = (e: TraceDecision['inicio']) => relevantHits(e).map((h) => h.nombre);
  const candidatos = new Set<string>();
  const add = (s?: string | null) => s && ![...candidatos].some((c) => samePlace(c, s)) && candidatos.add(s);
  const titleParts = `${ref.title} ${docName}`.replace(/^\s*\d+\s*(?:[.)]\s*-?|-)\s*/, '').split(/\s*-\s*/);
  titleParts.forEach((p) => add(p.replace(/\(.*?\)/g, '').trim()));
  for (const d of decs) {
    add(d.origen);
    add(d.destino);
    names(d.inicio).forEach(add);
    names(d.final).forEach(add);
  }
  // indice = posición en esta lista (un trazo reasignado puede repetir el índice de otro del mapa)
  const trazos = decs.map((d, i) => {
    const t = traces.get(d.traceId)!;
    return {
      indice: i,
      nombre: t.name,
      descripcion: t.text.DESCRIPCIO ?? '',
      tipo: t.text['AUTO-AMPL'] ?? t.kind,
      longitudKm: Number((t.lengthM / 1000).toFixed(2)),
      inicio: { localidades: names(d.inicio), municipio: d.inicio.municipio },
      final: { localidades: names(d.final), municipio: d.final.municipio },
      decisionActual: { origen: d.origen, destino: d.destino, sentido: d.sentido, motivos: d.revision },
    };
  });
  const similitudes = page.duplas
    .filter((x) => x.similitud && x.traces.every((id) => decs.some((d) => d.traceId === id)))
    .map((x) => ({
      a: decs.findIndex((d) => d.traceId === x.traces[0]),
      b: decs.findIndex((d) => d.traceId === x.traces[1]),
      clase: x.similitud!.clase,
      similitud: x.similitud!.similitud,
      sentido: x.similitud!.sentido,
    }));
  return {
    ruta: page.title || page.slug,
    mapa: ref.title,
    lugaresDelTitulo: titleParts.filter(Boolean),
    candidatos: [...candidatos].filter(Boolean),
    trazos,
    similitudes,
  };
}
