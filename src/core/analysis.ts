import { distance, length, lineString, point } from '@turf/turf';
import type { Coord } from './kml';
import { nearest, projectLine, projector, sampleLine, type Projected } from './geometry';

/** Igual que MAX_MARKER_DISTANCE_DEG (~0.005° ≈ 500 m) de import_routes.js. */
export const MAX_MARKER_DISTANCE_M = 500;

export const meters = (a: Coord, b: Coord) => distance(point(a), point(b), { units: 'meters' });

export const lengthKm = (coords: Coord[]) => length(lineString(coords), { units: 'kilometers' });

export const isCircuit = (coords: Coord[]) => meters(coords[0], coords[coords.length - 1]) < MAX_MARKER_DISTANCE_M;

export type MarkerStatus = { kind: 'none' } | { kind: 'ok' | 'reversed' | 'circuit' } | { kind: 'far'; meters: number };

/** Misma lógica que evaluateDirection() de import_routes.js, pero en metros. */
export function markerStatus(coords: Coord[], markers: { start?: Coord; end?: Coord }): MarkerStatus {
  if (!markers.start || !markers.end) return { kind: 'none' };
  const s = coords[0];
  const e = coords[coords.length - 1];
  if (meters(s, e) < MAX_MARKER_DISTANCE_M) return { kind: 'circuit' };
  const ss = meters(markers.start, s);
  const se = meters(markers.start, e);
  const es = meters(markers.end, s);
  const ee = meters(markers.end, e);
  const far = Math.max(Math.min(ss, se), Math.min(es, ee));
  if (far > MAX_MARKER_DISTANCE_M) return { kind: 'far', meters: Math.round(far) };
  return { kind: ss < se ? 'ok' : 'reversed' };
}

export interface Projection {
  /** % de puntos de A que quedan a ≤ tolerancia de B. */
  coverage: number;
  /** +1: A avanza en el mismo sentido que B; -1: en sentido contrario. */
  directionScore: number;
}

export function project(a: Projected, b: Projected, tolM: number): Projection {
  const n = Math.min(500, Math.max(60, Math.round(a.cum[a.cum.length - 1] / 25)));
  let within = 0;
  let inc = 0;
  let dec = 0;
  let prev: number | null = null;
  for (const p of sampleLine(a, n)) {
    const { dist, loc } = nearest(p, b);
    if (dist > tolM) {
      prev = null;
      continue;
    }
    within++;
    if (prev !== null) {
      // Cada paso cuenta igual: un "salto" de circuito pesa lo mismo que un paso normal.
      if (loc > prev + 1) inc++;
      else if (loc < prev - 1) dec++;
    }
    prev = loc;
  }
  return { coverage: within / n, directionScore: inc + dec === 0 ? 0 : (inc - dec) / (inc + dec) };
}

export type PairDirection = 'opuesto' | 'mismo' | 'indefinido';

export interface PairResult {
  /** Coincidencia promedio (0-1) entre ambos trazos a la tolerancia dada. */
  similarity: number;
  coverageAB: number;
  coverageBA: number;
  direction: PairDirection;
  directionScore: number;
  /** Distancias entre extremos (m). */
  ends: { startStart: number; startEnd: number; endStart: number; endEnd: number };
}

export function comparePair(a: Coord[], b: Coord[], tolM: number): PairResult {
  const { toXY } = projector((a[0][1] + b[0][1]) / 2);
  const pa = projectLine(a, toXY);
  const pb = projectLine(b, toXY);
  const ab = project(pa, pb, tolM);
  const ba = project(pb, pa, tolM);
  const directionScore = (ab.directionScore + ba.directionScore) / 2;
  const similarity = (ab.coverage + ba.coverage) / 2;
  const direction: PairDirection = similarity < 0.2 ? 'indefinido' : directionScore <= -0.3 ? 'opuesto' : directionScore >= 0.3 ? 'mismo' : 'indefinido';
  const [as, ae, bs, be] = [a[0], a[a.length - 1], b[0], b[b.length - 1]];
  return {
    similarity,
    coverageAB: ab.coverage,
    coverageBA: ba.coverage,
    direction,
    directionScore,
    ends: {
      startStart: meters(as, bs),
      startEnd: meters(as, be),
      endStart: meters(ae, bs),
      endEnd: meters(ae, be),
    },
  };
}

// ---------------------------------------------------------------------------
// Sentido según la descripción ("JOJUTLA-PUENTE DE IXTLA" = de Jojutla a Puente de Ixtla)
// ---------------------------------------------------------------------------

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export interface DescribedEnds {
  origin: string;
  destination: string;
  source: string;
}

/** Busca un texto "ORIGEN-DESTINO" en el ExtendedData o en el nombre. */
export function describedEnds(props: Record<string, string>, ...fallbacks: string[]): DescribedEnds | null {
  const descKey = Object.keys(props).find((k) => normalize(k).startsWith('DESCRIP'));
  const candidates = [descKey ? props[descKey] : '', ...fallbacks];
  for (const c of candidates) {
    const parts = c
      .replace(/\.(kml|kmz)$/i, '')
      .replace(/\(\d+\)\s*$/, '')
      .split(/\s*-\s*/)
      .map((p) => p.replace(/^\d+\s*\.\s*/, '').trim())
      .filter((p) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(p));
    if (parts.length < 2) continue;
    const origin = parts[0];
    const destination = parts[parts.length - 1];
    if (normalize(origin) === normalize(destination)) continue;
    return { origin, destination, source: c };
  }
  return null;
}

const mentions = (haystack: string, needle: string) => {
  const h = ` ${normalize(haystack)} `;
  const n = normalize(needle);
  return n.length >= 3 && h.includes(` ${n} `);
};

export type DescriptionHint = 'coincide' | 'invertido' | 'sin-datos';

export function descriptionHint(ends: DescribedEnds | null, startText?: string, endText?: string): DescriptionHint {
  if (!ends || !startText || !endText) return 'sin-datos';
  const forward = Number(mentions(startText, ends.origin)) + Number(mentions(endText, ends.destination));
  const backward = Number(mentions(startText, ends.destination)) + Number(mentions(endText, ends.origin));
  if (forward > backward) return 'coincide';
  if (backward > forward) return 'invertido';
  return 'sin-datos';
}
