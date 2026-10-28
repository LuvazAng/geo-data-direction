import type { Coord } from '@core';
import { tiledWays, type OverpassJson } from './overpass';

// Evalúa el sentido de un trazo contra las calles de un solo sentido de OpenStreetMap
// (etiqueta oneway=*). Si el trazo recorre mayormente calles en contraflujo, está invertido.

/** Radio de búsqueda de calles alrededor del trazo (m). */
const SEARCH_RADIUS_M = 25;
/** Distancia máxima entre el trazo y la calle para considerarlos la misma vía (m). */
const MATCH_DIST_M = 15;
/** Ángulo máximo entre el trazo y la calle para considerarlos paralelos. */
const MATCH_ANGLE_DEG = 30;
const STEP_M = 10;
/**
 * Si hay una vía de un sentido contrario a esta distancia, se trata de una vía de dos
 * cuerpos (se circula en ambos sentidos): el tramo no indica nada y se ignora.
 */
const DIVIDED_ROAD_M = 40;

export interface OnewayWay {
  id: number;
  name: string;
  /** Vértices en el sentido permitido de circulación. */
  coords: Coord[];
}

export interface OnewayStretch {
  name: string;
  meters: number;
  /** true = el trazo (en el orden recibido) va a favor de la calle. */
  agree: boolean;
  coords: Coord[];
}

export interface OnewayResult {
  /** Metros del trazo que van a favor / en contra de calles de un solo sentido. */
  agreeM: number;
  againstM: number;
  stretches: OnewayStretch[];
}

export type OnewayVerdict = 'correcto' | 'invertido' | 'mixto' | 'sin-datos';

// ---------------------------------------------------------------------------
// Descarga (Overpass)
// ---------------------------------------------------------------------------

function toWays(json: OverpassJson): OnewayWay[] {
  const ways: OnewayWay[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    // El transporte público puede circular en ambos sentidos
    if (t['oneway:psv'] === 'no' || t['oneway:bus'] === 'no') continue;
    const isRoundabout = t.junction === 'roundabout' || t.junction === 'circular';
    const oneway = t.oneway;
    if (oneway === 'no' || oneway === 'reversible' || oneway === 'alternating') continue;
    if (!isRoundabout && !['yes', 'true', '1', '-1'].includes(oneway ?? '')) continue;
    const coords = el.geometry.map((g): Coord => [g.lon, g.lat]);
    if (oneway === '-1') coords.reverse();
    ways.push({ id: el.id, name: t.name ?? t.ref ?? (isRoundabout ? 'glorieta' : `vía ${el.id}`), coords });
  }
  return ways;
}

/** Calles de un solo sentido alrededor del trazo (OSM vía Overpass, con caché por mosaico). */
export const fetchOneways = tiledWays(
  SEARCH_RADIUS_M,
  (b) => `  way(${b})["highway"]["oneway"];
  way(${b})["highway"]["junction"~"^(roundabout|circular)$"];`,
  toWays,
);

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

type XY = [number, number];

interface Seg {
  way: OnewayWay;
  a: XY;
  b: XY;
}

export function evaluateOneways(coords: Coord[], ways: OnewayWay[]): OnewayResult {
  const lat0 = coords[0][1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const toXY = (c: Coord): XY => [c[0] * kx, c[1] * ky];
  const toLngLat = (p: XY): Coord => [p[0] / kx, p[1] / ky];

  // Índice espacial simple en rejilla (3×3 celdas cubren el radio de búsqueda)
  const CELL = DIVIDED_ROAD_M + 10;
  const grid = new Map<string, Seg[]>();
  for (const way of ways) {
    const pts = way.coords.map(toXY);
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = { way, a: pts[i], b: pts[i + 1] };
      const [x0, x1] = [Math.min(seg.a[0], seg.b[0]), Math.max(seg.a[0], seg.b[0])];
      const [y0, y1] = [Math.min(seg.a[1], seg.b[1]), Math.max(seg.a[1], seg.b[1])];
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const k = `${cx},${cy}`;
          const list = grid.get(k) ?? [];
          list.push(seg);
          grid.set(k, list);
        }
    }
  }

  // Remuestreo del trazo cada STEP_M metros
  const pts = coords.map(toXY);
  const samples: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / STEP_M));
    for (let k = 1; k <= n; k++) samples.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }

  const cosMax = Math.cos((MATCH_ANGLE_DEG * Math.PI) / 180);
  let agreeM = 0;
  let againstM = 0;
  const stretches: OnewayStretch[] = [];
  let current: (OnewayStretch & { wayId: number }) | null = null;

  for (let i = 0; i < samples.length - 1; i++) {
    const p = samples[i];
    const q = samples[i + 1];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const mid: XY = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

    // Mejor candidata a favor y en contra por separado (vías de dos cuerpos)
    let bestFwd: { seg: Seg; dist: number; dot: number } | null = null;
    let bestRev: { seg: Seg; dist: number; dot: number } | null = null;
    const cx = Math.floor(mid[0] / CELL);
    const cy = Math.floor(mid[1] / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const seg of grid.get(`${gx},${gy}`) ?? []) {
          const sx = seg.b[0] - seg.a[0];
          const sy = seg.b[1] - seg.a[1];
          const slen = Math.hypot(sx, sy);
          if (slen === 0) continue;
          const dot = (dx * sx + dy * sy) / (len * slen);
          if (Math.abs(dot) < cosMax) continue; // no es paralela (cruce de calle)
          const t = Math.max(0, Math.min(1, ((mid[0] - seg.a[0]) * sx + (mid[1] - seg.a[1]) * sy) / (slen * slen)));
          const dist = Math.hypot(seg.a[0] + sx * t - mid[0], seg.a[1] + sy * t - mid[1]);
          if (dist > DIVIDED_ROAD_M) continue;
          if (dot > 0 && (!bestFwd || dist < bestFwd.dist)) bestFwd = { seg, dist, dot };
          if (dot < 0 && (!bestRev || dist < bestRev.dist)) bestRev = { seg, dist, dot };
        }

    // Vía de dos cuerpos (un sentido a cada lado): se circula en ambos, no decide nada.
    // Tampoco cuenta si la calle de un sentido más cercana está lejos del trazo.
    const best = bestFwd && bestRev ? null : (bestFwd ?? bestRev);
    if (best && best.dist > MATCH_DIST_M) {
      current = null;
      continue;
    }

    if (!best) {
      current = null;
      continue;
    }
    const agree = best.dot > 0;
    if (agree) agreeM += len;
    else againstM += len;

    if (current && current.wayId === best.seg.way.id && current.agree === agree) {
      current.meters += len;
      current.coords.push(toLngLat(q));
    } else {
      current = { wayId: best.seg.way.id, name: best.seg.way.name, agree, meters: len, coords: [toLngLat(p), toLngLat(q)] };
      stretches.push(current);
    }
  }

  return {
    agreeM,
    againstM,
    stretches: stretches.map(({ name, meters, agree, coords }) => ({ name, meters, agree, coords })),
  };
}

/** El mismo resultado visto con el trazo invertido. */
export const flipOneways = (r: OnewayResult): OnewayResult => ({
  agreeM: r.againstM,
  againstM: r.agreeM,
  stretches: r.stretches.map((s) => ({ ...s, agree: !s.agree, coords: [...s.coords].reverse() })).reverse(),
});

export function onewayVerdict(r: OnewayResult): OnewayVerdict {
  const total = r.agreeM + r.againstM;
  if (total < 50) return 'sin-datos';
  const ratio = (r.agreeM - r.againstM) / total;
  return ratio >= 0.5 ? 'correcto' : ratio <= -0.5 ? 'invertido' : 'mixto';
}

/** Calles agrupadas por nombre, de mayor a menor longitud. */
export function streetsSummary(r: OnewayResult, agree: boolean) {
  const byName = new Map<string, number>();
  for (const s of r.stretches) if (s.agree === agree) byName.set(s.name, (byName.get(s.name) ?? 0) + s.meters);
  return [...byName.entries()].sort((a, b) => b[1] - a[1]);
}
