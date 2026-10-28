import { type Coord, meters, normalize, PRINCIPAL_RATIO, relate, type RelationKind } from '@core';
import type { OrqConfig } from '../config';
import type { PlaceHit, PlaceIndex } from '../io/inegi';
import { mentions, samePlace, viaKey } from './places';
import type { PairMetrics } from './similarity';
import type { MapRef } from '../io/source';
import { parsePlaces, splitQualifier, type MapTraces, type TraceInfo } from './traces';
import type { Evidence, Role, Sentido } from '@protocol';

// Clasificación determinista de los trazos de una subpágina (una ruta). Cada decisión guarda
// sus evidencias; si no alcanzan o se contradicen, el trazo queda en revisión. Nunca se
// invierten coordenadas ni se inventa un sentido.

export type NameSource = 'DESCRIPCIO' | 'nombre' | 'indicaciones' | 'dupla' | 'titulo' | 'ia';

export interface EndInfo {
  coord: Coord;
  localidades: PlaceHit[];
  municipio?: string;
}

export interface TraceDecision {
  traceId: string;
  /** Mapa donde se publicó y mapa al que se asignó (distintos si se reasignó). */
  mapId: string;
  assignedMapId: string;
  index: number;
  role: Role;
  origen: string | null;
  destino: string | null;
  via: string | null;
  /** Clave de variante de la dupla (X LA GAS / X FARMACIA / MERCADO…). */
  variante: string;
  fuenteNombres: NameSource | null;
  inicio: EndInfo;
  final: EndInfo;
  sentido: Sentido;
  puntaje: number;
  evidencias: Evidence[];
  dupla?: string;
  /** Trazo idéntico a otro ya considerado (no se genera dos veces). */
  duplicadoDe?: string;
  relacion?: { principal: string; tipo: RelationKind; invertir: boolean; cobertura: number };
  revision: string[];
}

export interface Dupla {
  id: string;
  mapId: string;
  /** Posición dentro de la subpágina (1, 2, …): carpeta de salida. */
  n: number;
  traces: string[];
  variante: string;
  similitud?: PairMetrics;
}

export interface PageInput {
  slug: string;
  title: string;
  maps: { ref: MapRef; data: MapTraces }[];
}

export interface PageResult {
  slug: string;
  title: string;
  hub: string | null;
  terminal: { centro: Coord; puntos: number } | null;
  duplas: Dupla[];
  decisions: TraceDecision[];
}

export type SimFn = (a: TraceInfo, b: TraceInfo) => PairMetrics;

interface Described {
  origen: string;
  destino: string;
  via: string | null;
  variante: string;
  fuente: NameSource;
  circuito: boolean;
}

/** Lugares del título del mapa (encabezado de la página + nombre del documento KML). */
function titlePlaces(ref: MapRef, data: MapTraces) {
  const a = parsePlaces(ref.title);
  const b = parsePlaces(data.docName);
  const all = [...b.places, ...a.places].map((p) => splitQualifier(p).nombre);
  const unique: string[] = [];
  for (const p of all) if (!unique.some((u) => samePlace(u, p))) unique.push(p);
  return { places: unique, circuit: a.circuit || b.circuit, first: (b.places[0] ?? a.places[0]) && splitQualifier(b.places[0] ?? a.places[0]).nombre };
}

function fromPlaces(text: string, fuente: NameSource): Described | null {
  const p = parsePlaces(text);
  if (p.places.length < 2) return null;
  const parts = p.places.map(splitQualifier);
  const origen = parts[0].nombre;
  const last = p.circuit ? parts[parts.length - 2] : parts[parts.length - 1];
  if (!last || normalize(origen) === normalize(last.nombre)) return null;
  const qual = parts
    .map((x) => x.calificador)
    .filter(Boolean)
    .join(' ');
  return { origen, destino: last.nombre, via: p.via, variante: viaKey(p.via) || viaKey(qual), fuente, circuito: p.circuit };
}

/** "Indicaciones de <dirección> a <dirección>" (trazos hechos con Google Maps): se buscan los lugares del título. */
function fromDirections(text: string, places: string[]): Described | null {
  const m = /Indicaciones de (.+?) a (.+)$/i.exec(text);
  if (!m) return null;
  const o = places.find((p) => mentions(m[1], p));
  const d = places.find((p) => p !== o && mentions(m[2], p));
  // Si sólo se reconoce un extremo y el título tiene exactamente dos lugares, el otro es el restante
  const other = (x: string) => (places.length === 2 ? places.find((p) => !samePlace(p, x)) : undefined);
  const origen = o ?? (d ? other(d) : undefined);
  const destino = d ?? (o ? other(o) : undefined);
  if (!origen || !destino) return null;
  return { origen, destino, via: null, variante: '', fuente: 'indicaciones', circuito: false };
}

function describe(t: TraceInfo, docName: string, places: string[]): Described | null {
  const desc = t.text.DESCRIPCIO ?? '';
  if (!/^\s*Indicaciones de/i.test(desc)) {
    const d = fromPlaces(desc, 'DESCRIPCIO');
    if (d) return d;
  }
  if (t.name && normalize(t.name) !== normalize(docName) && !/^\s*Indicaciones de/i.test(t.name)) {
    const d = fromPlaces(t.name, 'nombre');
    if (d) return d;
  }
  return fromDirections(desc, places) ?? fromDirections(t.name, places);
}

/** Origen y destino aparecen en el título del mapa ("CIRCUITO ALPUYECA" sólo nombra uno). */
const belongs = (d: Described, places: string[]) => {
  const o = places.some((p) => samePlace(p, d.origen));
  const de = places.some((p) => samePlace(p, d.destino));
  return places.length === 1 ? o || de : o && de;
};

/** Terminal de la subpágina: el grupo de extremos con más puntos, si destaca claramente sobre el siguiente. */
function findTerminal(ends: Coord[], radiusM: number): { centro: Coord; puntos: number } | null {
  if (ends.length < 4) return null;
  const groups = ends.map((c) => ends.filter((o) => meters(c, o) <= radiusM));
  const order = groups.map((g, i) => ({ g, i })).sort((a, b) => b.g.length - a.g.length);
  const best = order[0];
  const center: Coord = [best.g.reduce((s, c) => s + c[0], 0) / best.g.length, best.g.reduce((s, c) => s + c[1], 0) / best.g.length];
  const rival = order.find((o) => meters(ends[o.i], center) > radiusM * 2);
  if (best.g.length < 3 || (rival && best.g.length < rival.g.length * 1.5)) return null;
  return { centro: center, puntos: best.g.length };
}

function endInfo(c: Coord, places: PlaceIndex, maxM: number): EndInfo {
  return { coord: c, localidades: places.near(c, maxM, 3), municipio: places.municipioDe(c) };
}

/** Localidades que cuentan para un extremo: la que lo contiene, o si no, las más cercanas (±300 m). */
export function relevantHits(end: EndInfo): PlaceHit[] {
  const inside = end.localidades.find((h) => h.dentro);
  if (inside) return [inside];
  const nearest = end.localidades[0]?.distanciaM ?? Infinity;
  return end.localidades.filter((h) => h.distanciaM <= nearest + 300);
}

/** Recorrido que regresa a su punto de partida (relativo a su longitud: una ruta urbana corta no es circuito). */
export const isLoop = (t: TraceInfo) => meters(t.first, t.last) <= Math.min(500, Math.max(100, 0.05 * t.lengthM));

/** Evidencias de que el archivo va de `origen` a `destino`. */
export function directionEvidence(
  d: Pick<TraceDecision, 'inicio' | 'final'>,
  origen: string,
  destino: string,
  ctx: { alias: Record<string, string>; hub: string | null; terminal: PageResult['terminal']; terminalM: number },
): Evidence[] {
  const ev: Evidence[] = [];
  // Una localidad que contiene a los dos extremos (Tetelpa dentro de la mancha de Zacatepec) no distingue el sentido
  const key = (h: PlaceHit) => h.cvegeo.slice(0, 9);
  const both = new Set(
    relevantHits(d.inicio)
      .map(key)
      .filter((k) => relevantHits(d.final).some((h) => key(h) === k)),
  );
  const at = (end: EndInfo, place: string) => relevantHits(end).find((h) => !both.has(key(h)) && samePlace(h.nombre, place, ctx.alias));
  const describeHit = (h: PlaceHit) => `${h.nombre}${h.dentro ? '' : ` a ${h.distanciaM} m`}`;
  const sameLocality = samePlace(origen, destino, ctx.alias);
  if (!sameLocality) {
    const matched = new Set<EndInfo>();
    for (const [end, label, place, w] of [
      [d.inicio, 'inicio', origen, 2],
      [d.final, 'final', destino, 2],
      [d.inicio, 'inicio', destino, -2],
      [d.final, 'final', origen, -2],
    ] as const) {
      const h = at(end, place);
      if (h) {
        matched.add(end);
        ev.push({ fuente: 'localidad', peso: w, detalle: `el ${label} está en ${describeHit(h)} (${place})` });
      }
    }
    // El municipio sólo distingue si cada extremo está en un municipio distinto (Tehuixtla y
    // Jojutla están en el mismo) y sólo para el extremo que no coincidió por localidad.
    const [mi, mf] = [d.inicio.municipio, d.final.municipio];
    if (mi && mf && !samePlace(mi, mf, ctx.alias)) {
      for (const [end, label, place, w] of [
        [d.inicio, 'inicio', origen, 1],
        [d.final, 'final', destino, 1],
        [d.inicio, 'inicio', destino, -1],
        [d.final, 'final', origen, -1],
      ] as const) {
        if (!matched.has(end) && end.municipio && samePlace(end.municipio, place, ctx.alias)) {
          ev.push({ fuente: 'municipio', peso: w, detalle: `el ${label} está en el municipio ${end.municipio} (${place})` });
        }
      }
    }
  }
  if (ctx.hub && ctx.terminal) {
    const near = (c: Coord) => meters(c, ctx.terminal!.centro) <= ctx.terminalM;
    const isHub = (p: string) => samePlace(p, ctx.hub!, ctx.alias);
    if (isHub(origen) && !isHub(destino)) {
      if (near(d.inicio.coord)) ev.push({ fuente: 'terminal', peso: 2, detalle: `el inicio está en la terminal de ${ctx.hub}` });
      if (near(d.final.coord)) ev.push({ fuente: 'terminal', peso: -2, detalle: `el final está en la terminal de ${ctx.hub}, pero ${ctx.hub} es el origen` });
    } else if (isHub(destino) && !isHub(origen)) {
      if (near(d.final.coord)) ev.push({ fuente: 'terminal', peso: 2, detalle: `el final está en la terminal de ${ctx.hub}` });
      if (near(d.inicio.coord))
        ev.push({ fuente: 'terminal', peso: -2, detalle: `el inicio está en la terminal de ${ctx.hub}, pero ${ctx.hub} es el destino` });
    }
  }
  return ev;
}

/** Circuito (empieza y termina en el mismo lugar): el inicio debe estar en el origen y el punto más lejano en el destino. */
export function circuitEvidence(
  d: Pick<TraceDecision, 'inicio'>,
  coords: Coord[],
  origen: string,
  destino: string,
  ctx: { alias: Record<string, string>; hub: string | null; terminal: PageResult['terminal']; terminalM: number },
  places: PlaceIndex,
  maxM: number,
): Evidence[] {
  const ev: Evidence[] = [];
  const h = relevantHits(d.inicio).find((x) => samePlace(x.nombre, origen, ctx.alias));
  if (h) ev.push({ fuente: 'localidad', peso: 2, detalle: `el circuito empieza en ${h.nombre} (${origen})` });
  else if (d.inicio.municipio && samePlace(d.inicio.municipio, origen, ctx.alias)) {
    ev.push({ fuente: 'municipio', peso: 1, detalle: `el circuito empieza en el municipio ${d.inicio.municipio} (${origen})` });
  }
  if (ctx.hub && ctx.terminal && samePlace(origen, ctx.hub, ctx.alias) && meters(d.inicio.coord, ctx.terminal.centro) <= ctx.terminalM) {
    ev.push({ fuente: 'terminal', peso: 2, detalle: `el circuito empieza en la terminal de ${ctx.hub}` });
  }
  const far = coords.reduce((best, c) => (meters(coords[0], c) > meters(coords[0], best) ? c : best), coords[0]);
  const fh = places.near(far, maxM, 3).find((x) => samePlace(x.nombre, destino, ctx.alias));
  if (fh) ev.push({ fuente: 'localidad', peso: 1, detalle: `el punto más lejano del circuito está en ${fh.nombre} (${destino})` });
  return ev;
}

export function decide(ev: Evidence[], circuit: boolean): { sentido: Sentido; puntaje: number } {
  const pos = ev.filter((e) => e.peso > 0).reduce((s, e) => s + e.peso, 0);
  const neg = ev.filter((e) => e.peso < 0).reduce((s, e) => s - e.peso, 0);
  const puntaje = pos - neg;
  if (circuit) return { sentido: pos > 0 && neg === 0 ? 'circuito' : neg > 0 ? 'contradictorio' : 'sin-evidencia', puntaje };
  if (pos > 0 && neg === 0) return { sentido: 'confirmado', puntaje };
  if (neg > 0 && pos === 0) return { sentido: 'contrario', puntaje };
  if (pos > 0 && neg > 0) return { sentido: 'contradictorio', puntaje };
  return { sentido: 'sin-evidencia', puntaje };
}

/**
 * Vuelve a evaluar el sentido con otros nombres de origen/destino (p. ej. los que propone la IA).
 * Devuelve las evidencias y la decisión; quien llama decide si los acepta.
 */
export function reevaluate(dec: TraceDecision, t: TraceInfo, origen: string, destino: string, page: PageResult, cfg: OrqConfig, places: PlaceIndex) {
  const ctx = { alias: cfg.nomenclatura.alias, hub: page.hub, terminal: page.terminal, terminalM: cfg.extremos.terminalM };
  const ev = isLoop(t)
    ? circuitEvidence(dec, t.coords, origen, destino, ctx, places, cfg.extremos.maxDistanciaM)
    : directionEvidence(dec, origen, destino, ctx);
  return { evidencias: ev, ...decide(ev, isLoop(t)) };
}

export function classifyPage(page: PageInput, cfg: OrqConfig, places: PlaceIndex, sim: SimFn): PageResult {
  const alias = cfg.nomenclatura.alias;
  const maxM = cfg.extremos.maxDistanciaM;
  const decisions = new Map<string, TraceDecision>();
  const trace = new Map<string, TraceInfo>();
  const described = new Map<string, Described | null>();
  const mapPlaces = new Map(page.maps.map(({ ref, data }) => [ref.id, titlePlaces(ref, data)]));

  // 1. Rol y nombres de cada trazo
  for (const { ref, data } of page.maps) {
    const tp = mapPlaces.get(ref.id)!;
    const desc = new Map(data.traces.map((t) => [t.id, describe(t, data.docName, tp.places)]));
    const candidates = data.traces.filter((t) => t.kind === 'itinerario' || (t.kind === 'otro' && desc.get(t.id)));
    const maxLen = Math.max(0, ...candidates.map((t) => t.lengthM));
    for (const t of data.traces) {
      trace.set(t.id, t);
      const d = desc.get(t.id) ?? null;
      let role: Role;
      if (t.kind === 'ampliacion') role = 'ampliacion';
      else if (t.kind === 'base') role = 'base';
      else if (candidates.includes(t)) role = t.lengthM >= PRINCIPAL_RATIO * maxLen ? 'principal' : 'tramo';
      else role = t.lengthM >= PRINCIPAL_RATIO * maxLen && maxLen > 0 ? 'otro' : 'tramo';
      described.set(t.id, role === 'principal' ? d : null);
      decisions.set(t.id, {
        traceId: t.id,
        mapId: ref.id,
        assignedMapId: ref.id,
        index: t.index,
        role,
        origen: role === 'principal' ? (d?.origen ?? null) : null,
        destino: role === 'principal' ? (d?.destino ?? null) : null,
        via: d?.via ?? t.via,
        variante: d?.variante ?? viaKey(t.via),
        fuenteNombres: role === 'principal' && d ? d.fuente : null,
        inicio: endInfo(t.first, places, maxM),
        final: endInfo(t.last, places, maxM),
        sentido: 'no-aplica',
        puntaje: 0,
        evidencias: [],
        revision: [],
      });
      const dec = decisions.get(t.id)!;
      for (const a of t.anomalies) if (/desconectado|fuera de Morelos|inválidas/.test(a)) dec.revision.push(`geometría anómala: ${a}`);
      if (role === 'otro') dec.revision.push('trazo largo sin metadatos que permitan saber qué es');
    }
  }

  // 2. Trazos publicados en el mapa equivocado: se asignan al mapa de la página cuyo título los nombra
  for (const { ref } of page.maps) {
    for (const dec of [...decisions.values()].filter((x) => x.mapId === ref.id && x.role === 'principal')) {
      const d = described.get(dec.traceId);
      if (!d || belongs(d, mapPlaces.get(ref.id)!.places)) continue;
      const home = page.maps.find((m) => m.ref.id !== ref.id && belongs(d, mapPlaces.get(m.ref.id)!.places));
      if (home) {
        dec.assignedMapId = home.ref.id;
        dec.evidencias.push({
          fuente: 'titulo',
          peso: 0,
          detalle: `publicado en «${ref.title}», pero «${d.origen}-${d.destino}» corresponde a «${home.ref.title}»`,
        });
      } else {
        dec.revision.push(`«${d.origen}-${d.destino}» no aparece en el título del mapa «${ref.title}»`);
      }
    }
  }

  // 3. Duplicados exactos dentro del mismo mapa asignado (p. ej. un trazo copiado en dos mapas)
  const principalsOf = (mapId: string) => [...decisions.values()].filter((x) => x.assignedMapId === mapId && x.role === 'principal' && !x.duplicadoDe);
  for (const { ref } of page.maps) {
    const list = principalsOf(ref.id);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].duplicadoDe) continue;
        const m = sim(trace.get(list[i].traceId)!, trace.get(list[j].traceId)!);
        // Misma geometría y mismos metadatos = copia. Misma geometría con metadatos distintos (A-B / B-A)
        // NO es copia: es el caso crítico de ida y regreso que se revisa más abajo.
        const key = (d: TraceDecision) => normalize(`${d.origen ?? ''}-${d.destino ?? ''}-${d.variante}`);
        if ((m.clase === 'identico' || m.clase === 'casi-identico') && key(list[i]) === key(list[j])) {
          const [keep, drop] = list[j].mapId === ref.id && list[i].mapId !== ref.id ? [list[j], list[i]] : [list[i], list[j]];
          drop.duplicadoDe = keep.traceId;
          drop.evidencias.push({ fuente: 'geometria', peso: 0, detalle: `${m.clase} a ${keep.traceId} (similitud ${m.similitud})` });
        }
      }
  }

  // 4. Terminal de la subpágina: el lugar que más se repite en los títulos y el grupo de extremos dominante
  const counts = new Map<string, { name: string; n: number }>();
  for (const { places: ps } of mapPlaces.values()) {
    const seen: string[] = [];
    for (const p of ps) {
      if (seen.some((s) => samePlace(s, p, alias))) continue;
      seen.push(p);
      const key = [...counts.keys()].find((k) => samePlace(k, p, alias)) ?? p;
      counts.set(key, { name: counts.get(key)?.name ?? p, n: (counts.get(key)?.n ?? 0) + 1 });
    }
  }
  // El nombre de la terminal lo da la localidad INEGI donde cae, no el título más repetido
  // (en Ruta 6A el título más común es Alpuyeca, pero los extremos se juntan en Jojutla).
  const byFrequency = [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.name);
  const ends = [...decisions.values()].filter((x) => x.role === 'principal' && !x.duplicadoDe).flatMap((x) => [x.inicio.coord, x.final.coord]);
  const cluster = findTerminal(ends, cfg.extremos.terminalM);
  const centerHits = cluster ? relevantHits(endInfo(cluster.centro, places, maxM)) : [];
  const hub = cluster ? (byFrequency.find((p) => centerHits.some((h) => samePlace(h.nombre, p, alias))) ?? null) : null;
  const terminal = hub ? cluster : null;

  // 5. Grupos por mapa: primero duplas (ida/regreso), luego extensiones conectadas.
  const duplas: Dupla[] = [];
  let n = 0;
  for (const { ref } of page.maps) {
    const list = principalsOf(ref.id).sort((a, b) => (a.mapId === b.mapId ? a.index - b.index : a.mapId === ref.id ? -1 : 1));
    const used = new Set<string>();
    const pairs: { a: TraceDecision; b: TraceDecision; score: number; m: PairMetrics }[] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        const m = sim(trace.get(a.traceId)!, trace.get(b.traceId)!);
        let score = -1;
        if (a.origen && b.origen && samePlace(a.origen, b.destino!, alias) && samePlace(a.destino!, b.origen, alias)) {
          if (a.variante && b.variante && a.variante !== b.variante) continue;
          score = 2 + (a.variante && a.variante === b.variante ? 1 : 0) + m.similitud;
        } else if ((!a.origen || !b.origen) && m.sentido === 'opuesto' && m.similitud >= cfg.similitud.duplaMin) {
          score = m.similitud;
        }
        if (score >= 0) pairs.push({ a, b, score, m });
      }
    pairs.sort((x, y) => y.score - x.score);
    const found: Omit<Dupla, 'n'>[] = [];
    for (const p of pairs) {
      if (used.has(p.a.traceId) || used.has(p.b.traceId)) continue;
      used.add(p.a.traceId).add(p.b.traceId);
      found.push({ id: '', mapId: ref.id, traces: [p.a.traceId, p.b.traceId], variante: p.a.variante || p.b.variante, similitud: p.m });
      // el que no traía nombres los toma de su pareja
      for (const [x, y] of [
        [p.a, p.b],
        [p.b, p.a],
      ] as const) {
        if (!x.origen && y.origen) {
          Object.assign(x, { origen: y.destino, destino: y.origen, fuenteNombres: 'dupla' as const });
          x.evidencias.push({ fuente: 'dupla', peso: 0, detalle: `nombres tomados de su pareja (${y.origen}-${y.destino})` });
        }
      }
    }
    for (const x of list) if (!used.has(x.traceId)) found.push({ id: '', mapId: ref.id, traces: [x.traceId], variante: x.variante });

    const singles = found.filter((group) => group.traces.length === 1);
    const connections = new Map(singles.map((group) => [group.traces[0], { neighbors: new Set<string>(), endpoints: [0, 0] as [number, number] }]));
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const a = decisions.get(singles[i].traces[0])!;
        const b = decisions.get(singles[j].traces[0])!;
        if (a.variante !== b.variante) continue;
        const connect = (from: TraceDecision, fromEnd: 0 | 1, to: TraceDecision, toEnd: 0 | 1) => {
          connections.get(from.traceId)!.neighbors.add(to.traceId);
          connections.get(to.traceId)!.neighbors.add(from.traceId);
          connections.get(from.traceId)!.endpoints[fromEnd]++;
          connections.get(to.traceId)!.endpoints[toEnd]++;
        };
        if (a.destino && b.origen && samePlace(a.destino, b.origen, alias)) connect(a, 1, b, 0);
        if (b.destino && a.origen && samePlace(b.destino, a.origen, alias)) connect(b, 1, a, 0);
      }
    }
    const visited = new Set<string>();
    for (const group of singles) {
      const start = group.traces[0];
      if (visited.has(start) || !connections.get(start)!.neighbors.size) continue;
      const component: string[] = [];
      const pending = [start];
      while (pending.length) {
        const traceId = pending.pop()!;
        if (visited.has(traceId)) continue;
        visited.add(traceId);
        component.push(traceId);
        pending.push(...connections.get(traceId)!.neighbors);
      }
      if (component.some((traceId) => connections.get(traceId)!.endpoints.some((count) => count > 1))) continue;
      const indexes = component.map((traceId) => found.findIndex((item) => item.traces[0] === traceId));
      const first = Math.min(...indexes);
      for (const index of indexes) found[index] = { ...found[index], traces: [] };
      found[first] = { ...group, traces: component };
    }
    for (let i = found.length - 1; i >= 0; i--) if (!found[i].traces.length) found.splice(i, 1);

    found.sort((a, b) => Math.min(...a.traces.map((id) => decisions.get(id)!.index)) - Math.min(...b.traces.map((id) => decisions.get(id)!.index)));
    for (const f of found) {
      n++;
      const id = `${page.slug}/${n}`;
      duplas.push({ ...f, id, n });
      for (const t of f.traces) decisions.get(t)!.dupla = id;
    }
  }

  // 6. Sentido de cada principal
  const ctx = { alias, hub, terminal, terminalM: cfg.extremos.terminalM };
  const evidenceFor = (dec: TraceDecision, t: TraceInfo, o: string, d: string) =>
    isLoop(t) ? circuitEvidence(dec, t.coords, o, d, ctx, places, maxM) : directionEvidence(dec, o, d, ctx);
  for (const dec of decisions.values()) {
    if (dec.role !== 'principal' || dec.duplicadoDe) continue;
    const t = trace.get(dec.traceId)!;
    const tp = mapPlaces.get(dec.assignedMapId)!;
    if (!dec.origen || !dec.destino) {
      // Sin nombres: el primer y el último lugar del título; la geometría decide cuál es cuál
      const two = tp.places.length >= 2 && !isLoop(t) ? [tp.places[0], tp.places[tp.places.length - 1]] : null;
      if (two) {
        const fwd = decide(evidenceFor(dec, t, two[0], two[1]), isLoop(t));
        const back = decide(evidenceFor(dec, t, two[1], two[0]), isLoop(t));
        const pick = fwd.sentido === 'confirmado' ? [two[0], two[1]] : back.sentido === 'confirmado' ? [two[1], two[0]] : null;
        if (pick) {
          Object.assign(dec, { origen: pick[0], destino: pick[1], fuenteNombres: 'titulo' as const });
          dec.evidencias.push({ fuente: 'titulo', peso: 0, detalle: `sin DESCRIPCIO: origen y destino tomados del título y de la localidad de cada extremo` });
        }
      }
      if (!dec.origen) {
        dec.sentido = 'sin-evidencia';
        dec.revision.push('no se pudo saber el origen y el destino (sin DESCRIPCIO ni nombre utilizable)');
        continue;
      }
    }
    dec.evidencias.push(...evidenceFor(dec, t, dec.origen, dec.destino!));
    const r = decide(dec.evidencias, isLoop(t));
    dec.sentido = dec.fuenteNombres === 'titulo' && r.sentido === 'confirmado' ? 'inferido' : r.sentido;
    dec.puntaje = r.puntaje;
    if (r.sentido === 'contrario') dec.revision.push(`el trazo va de ${dec.destino} a ${dec.origen}, al revés de lo que dice su ${dec.fuenteNombres}`);
    if (r.sentido === 'contradictorio') dec.revision.push('las evidencias del sentido se contradicen');
    if (r.sentido === 'sin-evidencia') dec.revision.push(`ningún extremo coincide con ${dec.origen} ni con ${dec.destino} (localidades INEGI / terminal)`);
  }

  // 7. Caso crítico: ida y regreso con la misma geometría en el mismo orden
  for (const d of duplas) {
    if (d.traces.length !== 2 || !d.similitud) continue;
    if (d.similitud.clase === 'identico' || d.similitud.clase === 'casi-identico') {
      for (const id of d.traces) {
        decisions.get(id)!.revision.push('la ida y el regreso tienen la misma geometría en el mismo orden: no se puede saber cuál es cada sentido');
      }
    }
    const [a, b] = d.traces.map((id) => decisions.get(id)!);
    if (a.sentido === 'contrario' && b.sentido === 'contrario') {
      for (const x of [a, b]) x.revision.push('los DESCRIPCIO de la dupla parecen estar intercambiados');
    }
  }

  // 8. Tramos, ampliaciones y bases: cómo se enganchan a la principal de su mapa
  for (const dec of decisions.values()) {
    if (dec.role === 'principal' || dec.role === 'otro') continue;
    const mains = principalsOf(dec.assignedMapId).filter((m) => !m.duplicadoDe);
    const t = trace.get(dec.traceId)!;
    const rels = mains.map((m) => ({ m, r: relate(t.coords, trace.get(m.traceId)!.coords) })).sort((x, y) => x.r.score - y.r.score);
    if (rels[0] && rels[0].r.kind !== 'ninguna') {
      dec.relacion = { principal: rels[0].m.traceId, tipo: rels[0].r.kind, invertir: rels[0].r.needsReverse, cobertura: Number(rels[0].r.overlap.toFixed(3)) };
    }
  }

  return { slug: page.slug, title: page.title, hub, terminal, duplas, decisions: [...decisions.values()] };
}
