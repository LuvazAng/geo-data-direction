import { type Coord, comparePair, meters, type PairDirection, type PairResult, nearest, projectLine, projector, sampleLine, totalLength } from '@core';
import type { OrqConfig } from '../config';

// Similitud geométrica entre dos trazos (reproducible: no hay azar ni IA de por medio).
//
//  coberturaAB  = % de puntos muestreados de A (cada ~25 m, 60–500 puntos) que quedan a
//                 ≤ toleranciaM de B. coberturaBA igual al revés. (comparePair de la app)
//  similitud    = (coberturaAB + coberturaBA) / 2
//  razonLongitud = longitud menor / longitud mayor
//  longitudCompartidaM = (coberturaAB·longA + coberturaBA·longB) / 2
//  distanciaMediaM / distanciaP95M = distancia de cada punto muestreado al otro trazo
//                 (ambos sentidos juntos): media y percentil 95
//  sentido      = mismo / opuesto según hacia dónde avanzan los puntos coincidentes
//
// Clases (umbrales en config.similitud):
//  identico            mismos vértices (≤ identicoM) en el mismo orden
//  identico-invertido  mismos vértices en orden inverso
//  casi-identico[-invertido]  ambas coberturas ≥ casiIdentico y razonLongitud ≥ longitudCasiIdentica
//  contenido           un trazo va casi completo sobre el otro (una cobertura ≥ casiIdentico)
//  parcial             similitud ≥ parcial
//  distinto            el resto

export type SimClass = 'identico' | 'identico-invertido' | 'casi-identico' | 'casi-identico-invertido' | 'contenido' | 'parcial' | 'distinto';

export interface PairMetrics {
  a: string;
  b: string;
  clase: SimClass;
  similitud: number;
  coberturaAB: number;
  coberturaBA: number;
  razonLongitud: number;
  longitudCompartidaM: number;
  distanciaMediaM: number;
  distanciaP95M: number;
  sentido: PairDirection;
  extremos: PairResult['ends'];
}

export interface Line {
  id: string;
  coords: Coord[];
  lengthM: number;
}

type Thresholds = OrqConfig['similitud'];

function sameVertices(a: Coord[], b: Coord[], tolM: number) {
  return a.length === b.length && a.every((c, i) => meters(c, b[i]) <= tolM);
}

function distances(a: Coord[], b: Coord[]): number[] {
  const { toXY } = projector((a[0][1] + b[0][1]) / 2);
  const pa = projectLine(a, toXY);
  const pb = projectLine(b, toXY);
  const n = Math.min(500, Math.max(60, Math.round(totalLength(pa) / 25)));
  return sampleLine(pa, n).map((p) => nearest(p, pb).dist);
}

const round = (n: number, d = 4) => Number(n.toFixed(d));

export function pairMetrics(a: Line, b: Line, t: Thresholds): PairMetrics {
  const pair = comparePair(a.coords, b.coords, t.toleranciaM);
  const ds = [...distances(a.coords, b.coords), ...distances(b.coords, a.coords)].sort((x, y) => x - y);
  const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
  const p95 = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))];
  const ratio = Math.min(a.lengthM, b.lengthM) / Math.max(a.lengthM, b.lengthM, 1e-9);

  let clase: SimClass;
  if (sameVertices(a.coords, b.coords, t.identicoM)) clase = 'identico';
  else if (sameVertices(a.coords, [...b.coords].reverse(), t.identicoM)) clase = 'identico-invertido';
  else if (pair.coverageAB >= t.casiIdentico && pair.coverageBA >= t.casiIdentico && ratio >= t.longitudCasiIdentica)
    clase = pair.direction === 'opuesto' ? 'casi-identico-invertido' : 'casi-identico';
  else if (Math.max(pair.coverageAB, pair.coverageBA) >= t.casiIdentico) clase = 'contenido';
  else if (pair.similarity >= t.parcial) clase = 'parcial';
  else clase = 'distinto';

  // En trazos idénticos el sentido es exacto, no estadístico
  const sentido: PairDirection = clase === 'identico' ? 'mismo' : clase === 'identico-invertido' ? 'opuesto' : pair.direction;
  return {
    a: a.id,
    b: b.id,
    clase,
    similitud: round(pair.similarity),
    coberturaAB: round(pair.coverageAB),
    coberturaBA: round(pair.coverageBA),
    razonLongitud: round(ratio),
    longitudCompartidaM: Math.round((pair.coverageAB * a.lengthM + pair.coverageBA * b.lengthM) / 2),
    distanciaMediaM: round(mean, 1),
    distanciaP95M: round(p95, 1),
    sentido,
    extremos: {
      startStart: Math.round(pair.ends.startStart),
      startEnd: Math.round(pair.ends.startEnd),
      endStart: Math.round(pair.ends.endStart),
      endEnd: Math.round(pair.ends.endEnd),
    },
  };
}

// ---------------------------------------------------------------------------
// Índice de celdas: sólo se comparan a detalle los pares que comparten suficientes celdas.
// ---------------------------------------------------------------------------

const MORELOS_LAT = 18.8;

function cellsOf(coords: Coord[], cellM: number): Set<string> {
  const { toXY } = projector(MORELOS_LAT);
  const line = projectLine(coords, toXY);
  const n = Math.max(2, Math.ceil(totalLength(line) / (cellM / 2)) + 1);
  const cells = new Set<string>();
  for (const [x, y] of sampleLine(line, n)) cells.add(`${Math.floor(x / cellM)},${Math.floor(y / cellM)}`);
  return cells;
}

/**
 * Pares candidatos: comparten al menos `minShare` de las celdas del trazo con menos celdas
 * (así un tramo corto contenido en uno largo también es candidato). `always` fuerza pares.
 */
export function candidatePairs(lines: Line[], cellM: number, minShare: number, always: (a: Line, b: Line) => boolean = () => false) {
  const cells = new Map(lines.map((l) => [l.id, cellsOf(l.coords, cellM)]));
  const index = new Map<string, string[]>();
  for (const l of lines) for (const c of cells.get(l.id)!) (index.get(c) ?? index.set(c, []).get(c)!).push(l.id);

  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: [Line, Line][] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const shared = new Map<string, number>();
    for (const c of cells.get(a.id)!) for (const other of index.get(c)!) if (other > a.id) shared.set(other, (shared.get(other) ?? 0) + 1);
    const seen = new Set<string>();
    for (const [id, count] of shared) {
      const b = byId.get(id)!;
      const share = count / Math.min(cells.get(a.id)!.size, cells.get(id)!.size);
      if (share >= minShare || always(a, b)) {
        out.push([a, b]);
        seen.add(id);
      }
    }
    for (const b of lines) if (b.id > a.id && !seen.has(b.id) && always(a, b)) out.push([a, b]);
  }
  return out;
}
