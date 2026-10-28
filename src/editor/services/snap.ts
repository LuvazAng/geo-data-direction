import { type Coord, dedupe, projectLine, projector, simplify, sliceAlong, totalLength, type XY } from '@core';
import { tiledWays, type OsmWay } from './overpass';

// Ajuste del trazo a las calles de OpenStreetMap ("map matching" con un modelo oculto de
// Markov, como Newson & Krumm 2009). El trazo se remuestrea; cada muestra tiene como candidatos
// los puntos de las calles a ≤ maxDist, y se elige la secuencia que mejor equilibra estar cerca
// del trazo con que el recorrido por la red de calles mida lo mismo que el trazo. Así no brinca
// a calles paralelas ni hace picos en los cruces, y las esquinas recortadas siguen la calle.
// Los tramos sin calle cerca se quedan como estaban. No se usa el sentido de las calles: el
// trazo puede venir invertido y eso se revisa aparte.

/** Distancia máxima a la calle que se puede elegir en la app (m). */
export const MAX_SNAP_M = 60;
/** Separación de las muestras del trazo (m). */
const STEP_M = 10;
const MAX_CANDIDATES = 6;
/** Escala (m) de la penalización por diferencia entre lo que mide el trazo y el recorrido por las calles. */
const BETA_M = 5;
/** Penalización (log-probabilidad) por ir perpendicular a la calle; evita tomar la transversal en un cruce. */
const HEADING_PENALTY = 2;
/** Una calle a más de este ángulo del trazo no es candidata (si no, a falta de la buena se metería a la transversal). */
const MAX_ANGLE_DEG = 60;
/** Más de esto seguido (sobre el trazo) sin calle cerca corta el ajuste: ese tramo se queda igual. */
const MAX_GAP_M = 150;
/** Tramos ajustados más cortos que esto se descartan (no vale la pena el quiebre). */
const MIN_CHAIN_M = 30;
/** Una ida y vuelta sobre la misma calle más corta que esto siempre es ruido (m). */
const MIN_UTURN_M = 15;
/** Hasta dónde se mide una ida y vuelta sobre la misma calle para decidir si se quita (m). */
const MAX_RETRACE_M = 500;

const HIGHWAYS = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
  'busway',
  'track',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
].join('|');

/** Calles por las que puede circular un vehículo alrededor del trazo (OSM vía Overpass, con caché por mosaico). */
export const fetchStreets = tiledWays<OsmWay>(
  MAX_SNAP_M + 20,
  (b) => `  way(${b})["highway"~"^(${HIGHWAYS})$"]["area"!="yes"]["service"!~"^(parking_aisle|driveway|drive-through)$"];`,
  (json) =>
    (json.elements ?? [])
      .filter((el) => el.type === 'way' && el.geometry && el.geometry.length >= 2)
      .map((el) => ({ id: el.id, coords: el.geometry!.map((g): Coord => [g.lon, g.lat]) })),
);

export interface SnapResult {
  /** Trazo ajustado, en el mismo sentido que el original. */
  coords: Coord[];
  /** Parte del trazo (0-1) que quedó sobre calles. */
  matched: number;
  /** Cuánto se movieron (m), en promedio y como máximo, los puntos ajustados. */
  meanShift: number;
  maxShift: number;
  /** Tramos que se quedaron como estaban por no tener calle cerca. */
  unmatched: Coord[][];
}

// ---------------------------------------------------------------------------
// Red de calles
// ---------------------------------------------------------------------------

interface Edge {
  a: number;
  b: number;
  len: number;
  way: number;
}

interface Graph {
  toXY: (c: Coord) => XY;
  toLngLat: (p: XY) => Coord;
  nodes: XY[];
  adj: { to: number; len: number }[][];
  edges: Edge[];
  /** Índice espacial en rejilla: celda → aristas. */
  grid: Map<string, number[]>;
}

const CELL_M = 40;
const graphs = new WeakMap<OsmWay[], Graph>();

/** Grafo no dirigido: las vías se unen donde comparten un nodo (mismas coordenadas en OSM). */
function graphOf(ways: OsmWay[]): Graph {
  const cached = graphs.get(ways);
  if (cached) return cached;
  const { toXY, toLngLat } = projector(ways[0].coords[0][1]);
  const nodes: XY[] = [];
  const adj: Graph['adj'] = [];
  const edges: Edge[] = [];
  const grid = new Map<string, number[]>();
  const ids = new Map<string, number>();
  const nodeOf = (c: Coord) => {
    const key = `${c[0].toFixed(7)},${c[1].toFixed(7)}`;
    let id = ids.get(key);
    if (id === undefined) {
      ids.set(key, (id = nodes.length));
      nodes.push(toXY(c));
      adj.push([]);
    }
    return id;
  };
  for (const way of ways) {
    for (let i = 1; i < way.coords.length; i++) {
      const a = nodeOf(way.coords[i - 1]);
      const b = nodeOf(way.coords[i]);
      const len = Math.hypot(nodes[b][0] - nodes[a][0], nodes[b][1] - nodes[a][1]);
      if (a === b || len === 0) continue;
      const e = edges.push({ a, b, len, way: way.id }) - 1;
      adj[a].push({ to: b, len });
      adj[b].push({ to: a, len });
      const [x0, x1] = [Math.min(nodes[a][0], nodes[b][0]), Math.max(nodes[a][0], nodes[b][0])];
      const [y0, y1] = [Math.min(nodes[a][1], nodes[b][1]), Math.max(nodes[a][1], nodes[b][1])];
      for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
        for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) {
          const k = `${cx},${cy}`;
          const list = grid.get(k);
          if (list) list.push(e);
          else grid.set(k, [e]);
        }
    }
  }
  const g = { toXY, toLngLat, nodes, adj, edges, grid };
  graphs.set(ways, g);
  return g;
}

/** Dijkstra acotado y reutilizable (arreglos tipados con "época" para no reinicializarlos). */
class Searcher {
  private dist: Float64Array;
  private prev: Int32Array;
  private stamp: Uint32Array;
  private epoch = 0;

  constructor(private g: Graph) {
    const n = g.nodes.length;
    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Uint32Array(n);
  }

  /** Distancias desde un punto de una arista hasta `limit` metros. */
  from(c: Cand, limit: number) {
    const { dist, prev, stamp, g } = this;
    const epoch = ++this.epoch;
    const heap: [number, number][] = [];
    const push = (node: number, d: number, from: number) => {
      if (stamp[node] === epoch && dist[node] <= d) return;
      stamp[node] = epoch;
      dist[node] = d;
      prev[node] = from;
      heap.push([d, node]);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const e = g.edges[c.e];
    push(e.a, c.t * e.len, -1);
    push(e.b, (1 - c.t) * e.len, -1);
    while (heap.length > 0) {
      const [d, node] = pop();
      if (d > limit) break;
      if (d > dist[node]) continue; // entrada vieja
      for (const { to, len } of g.adj[node]) push(to, d + len, node);
    }
  }

  distTo(node: number) {
    return this.stamp[node] === this.epoch ? this.dist[node] : Infinity;
  }

  /** Nodos desde el origen de la última búsqueda hasta `node`. */
  pathTo(node: number): number[] {
    const path: number[] = [];
    for (let n = node; n !== -1; n = this.prev[n]) path.push(n);
    return path.reverse();
  }
}

// ---------------------------------------------------------------------------
// Ajuste
// ---------------------------------------------------------------------------

/** Punto candidato sobre una arista (`t` = posición 0-1 de a → b). */
interface Cand {
  e: number;
  t: number;
  p: XY;
  /** Distancia a la muestra (m). */
  d: number;
  /** Log-probabilidad de que la muestra corresponda a este punto. */
  logE: number;
}

interface Step {
  /** Índice de la muestra. */
  i: number;
  cands: Cand[];
  score: Float64Array;
  back: Int32Array;
  /** Distancia máxima del recorrido desde el paso anterior. */
  limit: number;
}

const MIN_COS = Math.cos((MAX_ANGLE_DEG * Math.PI) / 180);

function candidates(g: Graph, p: XY, heading: XY | null, maxDist: number, sigma: number): Cand[] {
  const r = Math.ceil(maxDist / CELL_M);
  const cx = Math.floor(p[0] / CELL_M);
  const cy = Math.floor(p[1] / CELL_M);
  const seen = new Set<number>();
  // un candidato por vía (el mejor): los segmentos vecinos de la misma calle no son alternativas
  const byWay = new Map<number, Cand>();
  for (let gx = cx - r; gx <= cx + r; gx++)
    for (let gy = cy - r; gy <= cy + r; gy++)
      for (const e of g.grid.get(`${gx},${gy}`) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const { a, b, len, way } = g.edges[e];
        const A = g.nodes[a];
        const dx = g.nodes[b][0] - A[0];
        const dy = g.nodes[b][1] - A[1];
        const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / (len * len)));
        const q: XY = [A[0] + dx * t, A[1] + dy * t];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > maxDist) continue;
        const cos = heading ? Math.abs(heading[0] * dx + heading[1] * dy) / len : 1;
        if (cos < MIN_COS) continue;
        const logE = -0.5 * (d / sigma) ** 2 - HEADING_PENALTY * (1 - cos);
        const prev = byWay.get(way);
        if (!prev || logE > prev.logE) byWay.set(way, { e, t, p: q, d, logE });
      }
  return [...byWay.values()].sort((x, y) => y.logE - x.logE).slice(0, MAX_CANDIDATES);
}

/** Metros por la red de calles entre dos candidatos (`s` ya buscó desde `from`). */
function routeDist(g: Graph, s: Searcher, from: Cand, to: Cand) {
  const E = g.edges[to.e];
  if (from.e === to.e) return Math.abs(to.t - from.t) * E.len;
  return Math.min(s.distTo(E.a) + to.t * E.len, s.distTo(E.b) + (1 - to.t) * E.len);
}

/** Puntos del recorrido por las calles de `from` a `to` (sin incluir `from`). */
function routePath(g: Graph, s: Searcher, from: Cand, to: Cand, limit: number): XY[] {
  if (from.e === to.e) return [to.p];
  s.from(from, limit);
  const E = g.edges[to.e];
  const end = s.distTo(E.a) + to.t * E.len <= s.distTo(E.b) + (1 - to.t) * E.len ? E.a : E.b;
  return [...s.pathTo(end).map((n) => g.nodes[n]), to.p];
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Quita puntos repetidos (a menos de 0.5 m), junto con su muestra de origen. */
function dedupeXY(pts: XY[], src: number[]): [XY[], number[]] {
  const p = pts.slice(0, 1);
  const s = src.slice(0, 1);
  for (let i = 1; i < pts.length; i++) {
    if (dist(p[p.length - 1], pts[i]) < 0.5) continue;
    p.push(pts[i]);
    s.push(src[i]);
  }
  return [p, s];
}

/** Recorre la línea desde el vértice `i` hacia `dir`: punto a `s` metros (null si se acaba). */
function walker(pts: XY[], i: number, dir: 1 | -1) {
  let k = i;
  let done = 0;
  return (s: number): XY | null => {
    for (;;) {
      const n = k + dir;
      if (n < 0 || n >= pts.length) return null;
      const len = dist(pts[k], pts[n]);
      if (done + len >= s) {
        const t = len === 0 ? 0 : (s - done) / len;
        return [pts[k][0] + (pts[n][0] - pts[k][0]) * t, pts[k][1] + (pts[n][1] - pts[k][1]) * t];
      }
      done += len;
      k = n;
    }
  };
}

/**
 * Quita los picos: donde el recorrido da media vuelta y regresa sobre sí mismo (p. ej. se mete
 * unos metros a una transversal y vuelve) sin que el trazo original dé la vuelta ahí, o es
 * más corta que MIN_UTURN_M.
 * `src[k]` es la muestra de la que salió cada punto; `turnsAround(a, b)` dice si el trazo
 * original da media vuelta entre esas muestras (entonces es una vuelta en U real y se conserva).
 */
function removeSpikes(path: XY[], pathSrc: number[], turnsAround: (a: number, b: number) => boolean): XY[] {
  let [pts, src] = dedupeXY(path, pathSrc);
  for (let i = 1; i < pts.length - 1;) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const cos = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (dist(a, b) * dist(b, c));
    if (cos > -0.95) {
      i++;
      continue;
    }
    // cuánto regresa por donde vino
    const back = walker(pts, i, -1);
    const fwd = walker(pts, i, 1);
    let r = 0;
    for (let s = 0.5; s <= MAX_RETRACE_M; s += 0.5) {
      const x = back(s);
      const y = fwd(s);
      if (!x || !y || dist(x, y) > 0.5) break;
      r = s;
    }
    // puntos dentro del pico: kb + 1 … kf - 1
    let kb = i - 1;
    for (let d = dist(pts[i], pts[kb]); kb > 0 && d < r; kb--) d += dist(pts[kb], pts[kb - 1]);
    let kf = i + 1;
    for (let d = dist(pts[i], pts[kf]); kf < pts.length - 1 && d < r; kf++) d += dist(pts[kf], pts[kf + 1]);
    const inside = src.slice(kb + 1, kf);
    if (r >= MAX_RETRACE_M || (r >= MIN_UTURN_M && turnsAround(Math.min(...inside), Math.max(...inside)))) {
      i++;
      continue;
    }
    // se corta el pico: el recorrido sigue desde donde se separa
    const join = r > 0 ? [walker(pts, i, -1)(r)!] : [];
    [pts, src] = dedupeXY([...pts.slice(0, kb + 1), ...join, ...pts.slice(kf)], [...src.slice(0, kb + 1), ...join.map(() => src[i]), ...src.slice(kf)]);
    i = Math.max(1, i - 1);
  }
  return pts;
}

/**
 * Ajusta el trazo a las calles: cada parte a ≤ `maxDistM` de una calle se reemplaza por el
 * recorrido sobre ella; lo demás se conserva.
 */
export function snapToStreets(coords: Coord[], ways: OsmWay[], maxDistM: number): SnapResult {
  const unchanged: SnapResult = { coords, matched: 0, meanShift: 0, maxShift: 0, unmatched: [coords] };
  if (coords.length < 2 || ways.length === 0) return unchanged;
  const g = graphOf(ways);
  const line = projectLine(coords, g.toXY);
  const total = totalLength(line);
  if (total === 0) return unchanged;

  // Muestras cada STEP_M (incluye los vértices originales) con su posición sobre el trazo
  const samples: XY[] = [line.pts[0]];
  const along = [0];
  for (let i = 1; i < line.pts.length; i++) {
    const [a, b] = [line.pts[i - 1], line.pts[i]];
    const len = line.cum[i] - line.cum[i - 1];
    if (len === 0) continue;
    const n = Math.max(1, Math.round(len / STEP_M));
    for (let k = 1; k <= n; k++) {
      samples.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      along.push(line.cum[i - 1] + (len * k) / n);
    }
  }
  const headings = samples.map((_, i): XY | null => {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const len = dist(a, b);
    return len === 0 ? null : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  });
  /** El trazo original da media vuelta entre las muestras `a` y `b` (con un poco de margen). */
  const turnsAround = (a: number, b: number) => {
    const from = Math.max(0, a - 2);
    const to = Math.min(samples.length - 1, b + 2);
    for (let i = from; i <= to; i++)
      for (let j = i + 1; j <= to; j++) {
        const [h, k] = [headings[i], headings[j]];
        if (h && k && h[0] * k[0] + h[1] * k[1] < -0.5) return true;
      }
    return false;
  };

  // Viterbi por tramos: si no hay calle cerca por mucho rato, o no hay recorrido posible entre
  // un paso y el siguiente, se cierra el tramo y empieza otro.
  const sigma = maxDistM / 2;
  const searcher = new Searcher(g);
  const chains: Step[][] = [];
  let steps: Step[] = [];
  const close = () => {
    if (steps.length > 0) chains.push(steps);
    steps = [];
  };
  const fresh = (i: number, cands: Cand[]): Step => ({
    i,
    cands,
    score: Float64Array.from(cands, (c) => c.logE),
    back: new Int32Array(cands.length).fill(-1),
    limit: 0,
  });

  for (let i = 0; i < samples.length; i++) {
    const cands = candidates(g, samples[i], headings[i], maxDistM, sigma);
    const prev = steps[steps.length - 1];
    if (cands.length === 0) {
      if (prev && along[i] - along[prev.i] > MAX_GAP_M) close();
      continue;
    }
    if (!prev) {
      steps.push(fresh(i, cands));
      continue;
    }
    const gc = dist(samples[prev.i], samples[i]);
    const limit = 1.6 * gc + 2 * maxDistM + 20;
    const score = new Float64Array(cands.length).fill(-Infinity);
    const back = new Int32Array(cands.length).fill(-1);
    prev.cands.forEach((pc, k) => {
      if (prev.score[k] === -Infinity) return;
      searcher.from(pc, limit);
      cands.forEach((c, j) => {
        const route = routeDist(g, searcher, pc, c);
        if (route > limit) return;
        const s = prev.score[k] - Math.abs(route - gc) / BETA_M + c.logE;
        if (s > score[j]) {
          score[j] = s;
          back[j] = k;
        }
      });
    });
    if (score.every((s) => s === -Infinity)) {
      close();
      steps.push(fresh(i, cands));
    } else {
      steps.push({ i, cands, score, back, limit });
    }
  }
  close();

  // Mejor secuencia de cada tramo; se descartan los muy cortos
  const out: XY[] = [];
  const unmatched: XY[][] = [];
  const shifts: number[] = [];
  let cursor = 0;
  let matchedM = 0;
  for (const chain of chains) {
    const first = along[chain[0].i];
    const last = along[chain[chain.length - 1].i];
    if (last - first < MIN_CHAIN_M) continue;
    const chosen = Array.from<Cand>({ length: chain.length });
    const lastScore = chain[chain.length - 1].score;
    let j = lastScore.indexOf(Math.max(...lastScore));
    for (let k = chain.length - 1; k >= 0; k--) {
      chosen[k] = chain[k].cands[j];
      j = chain[k].back[j];
    }

    if (first > cursor) {
      const piece = sliceAlong(line, cursor, first);
      out.push(...piece);
      unmatched.push(piece);
    }
    const path: XY[] = [chosen[0].p];
    const src = [chain[0].i];
    for (let k = 1; k < chain.length; k++) {
      const leg = routePath(g, searcher, chosen[k - 1], chosen[k], chain[k].limit);
      path.push(...leg);
      src.push(...leg.map(() => chain[k].i));
    }
    out.push(...removeSpikes(path, src, turnsAround));
    for (const c of chosen) shifts.push(c.d);
    matchedM += last - first;
    cursor = last;
  }
  if (shifts.length === 0) return unchanged;
  if (cursor < total) {
    const piece = sliceAlong(line, cursor, total);
    out.push(...piece);
    unmatched.push(piece);
  }

  return {
    // sin los puntos intermedios alineados (las muestras que caen a media cuadra)
    coords: simplify(dedupe(out.map(g.toLngLat)), 0.2),
    matched: matchedM / total,
    meanShift: shifts.reduce((a, b) => a + b, 0) / shifts.length,
    maxShift: Math.max(...shifts),
    unmatched: unmatched.filter((u) => u.length > 1).map((u) => u.map(g.toLngLat)),
  };
}
