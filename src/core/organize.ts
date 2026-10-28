import type { Coord } from './kml';
import { comparePair, project, type PairResult } from './analysis';
import { closestVertex, dedupe, nearest, pointAt, projectLine, projector, sliceAlong, totalLength, type XY } from './geometry';

// Reglas fijas (deterministas) para organizar una carpeta con varios trazos.

/** Un trazo es principal si mide al menos este % del más largo de la carpeta. */
export const PRINCIPAL_RATIO = 0.5;
/** Dos principales forman dupla (ida/regreso) si coinciden al menos este %. */
export const DUPLA_MIN_SIMILARITY = 0.4;
/** Un extremo del tramo corto "se engancha" a la ruta si queda a esta distancia o menos. */
export const ATTACH_M = 150;
/** Margen para decidir si el enganche está en el inicio / final de la ruta principal. */
export const END_ZONE_M = 300;
/** Si el tramo sale y vuelve a la ruta a menos de esto, es un lazo. */
export const LOOP_M = 200;
/** % del tramo que debe ir encima de la ruta para considerarlo parte de ella. */
export const OVERLAP_RATIO = 0.8;
/** Si el enganche cae a esta distancia (sobre la ruta) de un vértice, se corta en el vértice. */
export const SNAP_M = 30;

export type RelationKind = 'variante' | 'lazo' | 'ext-final' | 'ext-inicio' | 'ramal-salida' | 'ramal-entrada' | 'sobre' | 'ninguna';

export const RELATION_TEXT: Record<RelationKind, string> = {
  variante: 'Variante: sale de la ruta y se reincorpora más adelante',
  lazo: 'Lazo: sale de la ruta y regresa al mismo punto',
  'ext-final': 'Extensión: continúa después del final de la ruta',
  'ext-inicio': 'Extensión: llega al inicio de la ruta desde otro punto',
  'ramal-salida': 'Ramal: sale de la ruta y termina en otro destino',
  'ramal-entrada': 'Ramal: viene de otro origen y se incorpora a la ruta',
  sobre: 'Va encima de la ruta (tramo repetido)',
  ninguna: 'No se toca con la ruta',
};

export interface Relation {
  kind: RelationKind;
  /** El tramo hay que invertirlo para que coincida con el sentido de la ruta. */
  needsReverse: boolean;
  /** Posición (m) sobre la ruta donde sale / se reincorpora el tramo (ya orientado). */
  outAt?: number;
  inAt?: number;
  /** Distancia (m) de los extremos del tramo a la ruta. */
  gap: number;
  /** % del tramo que va encima de la ruta. */
  overlap: number;
  /** Menor = encaja mejor. */
  score: number;
  /** Vértice (1 = primero) de la principal donde sale / se reincorpora, y su ubicación. */
  outVertex?: number;
  inVertex?: number;
  outCoord?: Coord;
  inCoord?: Coord;
  mainVertices?: number;
}

export const canBuildAlternative = (r: Relation) => r.kind !== 'sobre' && r.kind !== 'ninguna';

export function relate(short: Coord[], main: Coord[]): Relation {
  const { toXY } = projector(main[0][1]);
  const M = projectLine(main, toXY);
  const S = projectLine(short, toXY);
  const total = totalLength(M);
  const first = nearest(S.pts[0], M);
  const last = nearest(S.pts[S.pts.length - 1], M);
  const overlap = project(S, M, 30);

  const startOn = first.dist <= ATTACH_M;
  const endOn = last.dist <= ATTACH_M;
  const base = { overlap: overlap.coverage };

  let rel: Omit<Relation, 'score'>;
  if (overlap.coverage >= OVERLAP_RATIO) {
    rel = { ...base, kind: 'sobre', needsReverse: overlap.directionScore < 0, gap: first.dist + last.dist };
  } else if (startOn && endOn) {
    if (Math.abs(first.loc - last.loc) < LOOP_M) {
      const at = Math.min(first.loc, last.loc);
      rel = { ...base, kind: 'lazo', needsReverse: false, outAt: at, inAt: at, gap: first.dist + last.dist };
    } else {
      const needsReverse = first.loc > last.loc;
      rel = {
        ...base,
        kind: 'variante',
        needsReverse,
        outAt: Math.min(first.loc, last.loc),
        inAt: Math.max(first.loc, last.loc),
        gap: first.dist + last.dist,
      };
    }
  } else if (startOn || endOn) {
    const att = startOn ? first : last;
    if (att.loc >= total - END_ZONE_M) {
      // debe arrancar donde termina la ruta
      rel = { ...base, kind: 'ext-final', needsReverse: !startOn, outAt: att.loc, gap: att.dist };
    } else if (att.loc <= END_ZONE_M) {
      // debe terminar donde arranca la ruta
      rel = { ...base, kind: 'ext-inicio', needsReverse: startOn, inAt: att.loc, gap: att.dist };
    } else if (startOn) {
      rel = { ...base, kind: 'ramal-salida', needsReverse: false, outAt: att.loc, gap: att.dist };
    } else {
      rel = { ...base, kind: 'ramal-entrada', needsReverse: false, inAt: att.loc, gap: att.dist };
    }
  } else {
    rel = { ...base, kind: 'ninguna', needsReverse: false, gap: first.dist + last.dist };
  }

  const score =
    rel.kind === 'ninguna' ? Number.POSITIVE_INFINITY : (rel.kind === 'sobre' ? 500 : 0) + (rel.needsReverse ? 1000 : 0) + rel.gap - overlap.coverage * 100;
  // Vértice de la ruta principal donde sale / se reincorpora el tramo. Si hay uno a
  // ≤ SNAP_M del punto de enganche, se corta justo ahí para no crear segmentos mínimos.
  const { toLngLat } = projector(main[0][1]);
  const snap = (at?: number) => {
    if (at === undefined) return {};
    const i = closestVertex(M, at);
    const snapped = Math.abs(M.cum[i] - at) <= SNAP_M ? M.cum[i] : at;
    return { at: snapped, vertex: i + 1, coord: toLngLat(pointAt(M, snapped)) };
  };
  const out = snap(rel.outAt);
  const inn = snap(rel.inAt);
  return {
    ...rel,
    outAt: out.at,
    inAt: inn.at,
    outVertex: out.vertex,
    inVertex: inn.vertex,
    outCoord: out.coord,
    inCoord: inn.coord,
    mainVertices: main.length,
    score,
  };
}

/** Misma relación, pero saliendo / reincorporándose en los vértices indicados (1 = primero). */
export function withVertices(rel: Relation, main: Coord[], outVertex?: number, inVertex?: number): Relation {
  const { toXY, toLngLat } = projector(main[0][1]);
  const M = projectLine(main, toXY);
  const clamp = (v: number) => Math.min(main.length, Math.max(1, Math.round(v)));
  const next = { ...rel };
  if (outVertex !== undefined && rel.outAt !== undefined) {
    next.outVertex = clamp(outVertex);
    next.outAt = M.cum[next.outVertex - 1];
    next.outCoord = toLngLat(M.pts[next.outVertex - 1]);
  }
  if (inVertex !== undefined && rel.inAt !== undefined) {
    next.inVertex = clamp(inVertex);
    next.inAt = M.cum[next.inVertex - 1];
    next.inCoord = toLngLat(M.pts[next.inVertex - 1]);
  }
  return next;
}

/** Ruta principal + tramo corto → trazo completo de la ruta alterna. */
export function buildAlternative(main: Coord[], short: Coord[], rel: Relation): Coord[] {
  const { toXY, toLngLat } = projector(main[0][1]);
  const M = projectLine(main, toXY);
  const total = totalLength(M);
  const s = (rel.needsReverse ? [...short].reverse() : short).map(toXY);
  const before = (at: number) => sliceAlong(M, 0, at);
  const after = (at: number) => sliceAlong(M, at, total);

  let out: XY[];
  switch (rel.kind) {
    case 'variante':
    case 'lazo':
      out = [...before(rel.outAt!), ...s, ...after(Math.max(rel.outAt!, rel.inAt!))];
      break;
    case 'ext-final':
    case 'ramal-salida':
      out = [...before(rel.outAt!), ...s];
      break;
    case 'ext-inicio':
    case 'ramal-entrada':
      out = [...s, ...after(rel.inAt!)];
      break;
    default:
      throw new Error('Este tramo no se puede unir a la ruta');
  }
  return dedupe(out.map(toLngLat));
}

// ---------------------------------------------------------------------------
// Carpeta completa
// ---------------------------------------------------------------------------

export interface OrgItem {
  id: string;
  coords: Coord[];
  lengthM: number;
}

export interface Dupla {
  n: number;
  ids: string[];
  pair?: PairResult;
}

export interface Organization {
  role: Record<string, { kind: 'principal' | 'corto'; percent: number }>;
  duplas: Dupla[];
  /** Por tramo corto: relación con cada principal, de mejor a peor ajuste. */
  relations: Record<string, ({ mainId: string } & Relation)[]>;
  /** Subcarpeta sugerida para cada trazo. */
  folderOf: Record<string, string>;
}

export function organize(items: OrgItem[], tolM: number): Organization {
  const maxLen = Math.max(...items.map((i) => i.lengthM), 1);
  const role: Organization['role'] = {};
  for (const it of items) {
    const percent = it.lengthM / maxLen;
    role[it.id] = { kind: percent >= PRINCIPAL_RATIO ? 'principal' : 'corto', percent };
  }
  const principals = items.filter((i) => role[i.id].kind === 'principal');
  const shorts = items.filter((i) => role[i.id].kind === 'corto');

  // Duplas: emparejamiento voraz por mayor coincidencia (independiente del sentido)
  const candidates: { a: OrgItem; b: OrgItem; pair: PairResult }[] = [];
  for (let i = 0; i < principals.length; i++)
    for (let j = i + 1; j < principals.length; j++) {
      const pair = comparePair(principals[i].coords, principals[j].coords, tolM);
      if (pair.similarity >= DUPLA_MIN_SIMILARITY) candidates.push({ a: principals[i], b: principals[j], pair });
    }
  candidates.sort((x, y) => y.pair.similarity - x.pair.similarity);
  const used = new Set<string>();
  const found: Omit<Dupla, 'n'>[] = [];
  for (const c of candidates) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    used.add(c.a.id).add(c.b.id);
    found.push({ ids: [c.a.id, c.b.id], pair: c.pair });
  }
  for (const p of principals) if (!used.has(p.id)) found.push({ ids: [p.id] });
  // numeradas en el orden de la carpeta (los trazos ya vienen de mayor a menor longitud)
  const order = new Map(items.map((it, i) => [it.id, i]));
  found.sort((x, y) => Math.min(...x.ids.map((id) => order.get(id)!)) - Math.min(...y.ids.map((id) => order.get(id)!)));
  const duplas = found.map((d, i) => ({ ...d, n: i + 1 }));

  const folderOf: Record<string, string> = {};
  for (const d of duplas) for (const id of d.ids) folderOf[id] = String(d.n);

  const relations: Organization['relations'] = {};
  for (const s of shorts) {
    relations[s.id] = principals
      .map((p) => ({ mainId: p.id, ...relate(s.coords, p.coords) }))
      .sort((x, y) => x.score - y.score || x.mainId.localeCompare(y.mainId));
    const best = relations[s.id][0];
    folderOf[s.id] = best && best.kind !== 'ninguna' ? folderOf[best.mainId] : 'sin-relacion';
  }

  return { role, duplas, relations, folderOf };
}
