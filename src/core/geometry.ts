import type { Coord } from './kml';

// Proyección local en metros (equirectangular). Precisión de sobra a escala estatal
// y mucho más rápida que turf en ciclos internos.

export type XY = [number, number];

export interface Projected {
  pts: XY[];
  /** Distancia acumulada (m) hasta cada vértice. */
  cum: number[];
}

export function projector(lat0: number) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: (c: Coord): XY => [c[0] * kx, c[1] * ky],
    toLngLat: (p: XY): Coord => [p[0] / kx, p[1] / ky],
  };
}

export function projectLine(coords: Coord[], toXY: (c: Coord) => XY): Projected {
  const pts = coords.map(toXY);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum };
}

export const totalLength = (line: Projected) => line.cum[line.cum.length - 1];

/** Punto a `d` metros del inicio de la línea. */
export function pointAt({ pts, cum }: Projected, d: number): XY {
  if (d <= 0) return pts[0];
  let i = 0;
  while (i < pts.length - 2 && cum[i + 1] < d) i++;
  const len = cum[i + 1] - cum[i] || 1;
  const t = Math.min(1, Math.max(0, (d - cum[i]) / len));
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

/** Índice del vértice más cercano a la posición `d` (m) sobre la línea. */
export function closestVertex({ cum }: Projected, d: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  return Math.abs(cum[lo] - d) <= Math.abs(cum[hi] - d) ? lo : hi;
}

export function sampleLine(line: Projected, n: number): XY[] {
  const total = totalLength(line);
  return Array.from({ length: n }, (_, k) => pointAt(line, (total * k) / (n - 1)));
}

/** Punto más cercano de la línea: distancia (m) y posición a lo largo de ella (m). */
export function nearest(p: XY, { pts, cum }: Projected) {
  let best = Infinity;
  let loc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const ex = ax + dx * t - p[0];
    const ey = ay + dy * t - p[1];
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      loc = cum[i] + Math.sqrt(len2) * t;
    }
  }
  return { dist: Math.sqrt(best), loc };
}

/** Vértices de la línea entre `from` y `to` metros (con los extremos interpolados). */
export function sliceAlong(line: Projected, from: number, to: number): XY[] {
  const total = totalLength(line);
  from = Math.max(0, Math.min(total, from));
  to = Math.max(0, Math.min(total, to));
  if (to <= from) return [pointAt(line, from)];
  const out: XY[] = [pointAt(line, from)];
  line.cum.forEach((d, i) => {
    if (d > from && d < to) out.push(line.pts[i]);
  });
  out.push(pointAt(line, to));
  return out;
}

const distToSegment = (p: XY, a: XY, b: XY) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
};

/**
 * Douglas-Peucker en metros: elimina vértices sin que el trazo se aleje más de
 * `toleranceM` del original. Siempre conserva el primer y el último punto.
 */
export function simplify(coords: Coord[], toleranceM: number): Coord[] {
  const n = coords.length;
  if (n <= 2 || toleranceM <= 0) return coords;
  const { toXY } = projector(coords[0][1]);
  const p = coords.map(toXY);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(p[i], p[a], p[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Quita puntos consecutivos repetidos (a menos de 0.5 m). */
export function dedupe(coords: Coord[]): Coord[] {
  if (coords.length === 0) return coords;
  const { toXY } = projector(coords[0][1]);
  const out = [coords[0]];
  for (const c of coords.slice(1)) {
    const [ax, ay] = toXY(out[out.length - 1]);
    const [bx, by] = toXY(c);
    if (Math.hypot(ax - bx, ay - by) >= 0.5) out.push(c);
  }
  return out;
}
