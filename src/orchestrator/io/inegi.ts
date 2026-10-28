import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Coord, normalize, projector } from '@core';

// Localidades del Marco Geoestadístico de INEGI (ya están en GEODATA):
//   17l   polígonos de localidades urbanas y rurales amanzanadas
//   17lpr localidades rurales puntuales
//   17mun municipios
// Vienen en Lambert Cónica Conforme (ITRF2008) con DBF en ISO-8859-1. Se leen con un lector
// mínimo de shapefile (puntos y polígonos) para no agregar dependencias.

// ---------------------------------------------------------------------------
// Shapefile / DBF
// ---------------------------------------------------------------------------

export type ShpGeom = { type: 'point'; xy: [number, number] } | { type: 'polygon'; rings: [number, number][][] } | null;

export function readShp(buf: Buffer): ShpGeom[] {
  if (buf.readInt32BE(0) !== 9994) throw new Error('No es un shapefile');
  const end = buf.readInt32BE(24) * 2;
  const out: ShpGeom[] = [];
  for (let o = 100; o + 8 <= end;) {
    const len = buf.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = buf.readInt32LE(c);
    if (type === 1 || type === 11 || type === 21) {
      out.push({ type: 'point', xy: [buf.readDoubleLE(c + 4), buf.readDoubleLE(c + 12)] });
    } else if (type === 5 || type === 15 || type === 25) {
      const numParts = buf.readInt32LE(c + 36);
      const numPoints = buf.readInt32LE(c + 40);
      const parts = Array.from({ length: numParts }, (_, i) => buf.readInt32LE(c + 44 + i * 4));
      const p0 = c + 44 + numParts * 4;
      const rings = parts.map((start, i) => {
        const stop = i + 1 < numParts ? parts[i + 1] : numPoints;
        return Array.from({ length: stop - start }, (_, k): [number, number] => [
          buf.readDoubleLE(p0 + (start + k) * 16),
          buf.readDoubleLE(p0 + (start + k) * 16 + 8),
        ]);
      });
      out.push({ type: 'polygon', rings });
    } else {
      out.push(null);
    }
    o = c + len;
  }
  return out;
}

export function readDbf(buf: Buffer, encoding: BufferEncoding = 'latin1'): Record<string, string>[] {
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; buf[o] !== 0x0d && o < headerLen; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/s, ''), len: buf[o + 16] });
  }
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < n; r++) {
    let p = headerLen + r * recordLen;
    const deleted = buf[p] === 0x2a;
    p++;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = buf.toString(encoding, p, p + f.len).trim();
      p += f.len;
    }
    rows.push(deleted ? { ...row, __borrado: '1' } : row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Lambert Cónica Conforme (2 paralelos) inversa — Snyder, "Map Projections", p. 107-109
// ---------------------------------------------------------------------------

export interface LccParams {
  a: number;
  invF: number;
  lat0: number;
  lon0: number;
  lat1: number;
  lat2: number;
  fe: number;
  fn: number;
}

export function parsePrj(prj: string): LccParams {
  if (!/Lambert_Conformal_Conic/i.test(prj)) throw new Error('Proyección no soportada (se esperaba Lambert_Conformal_Conic)');
  const param = (name: string) => {
    const m = new RegExp(`PARAMETER\\["${name}",\\s*(-?[\\d.]+)\\]`, 'i').exec(prj);
    if (!m) throw new Error(`Falta ${name} en el .prj`);
    return Number(m[1]);
  };
  const sph = /SPHEROID\["[^"]*",\s*([\d.]+),\s*([\d.]+)\]/i.exec(prj);
  if (!sph) throw new Error('Falta SPHEROID en el .prj');
  return {
    a: Number(sph[1]),
    invF: Number(sph[2]),
    lat0: param('Latitude_Of_Origin'),
    lon0: param('Central_Meridian'),
    lat1: param('Standard_Parallel_1'),
    lat2: param('Standard_Parallel_2'),
    fe: param('False_Easting'),
    fn: param('False_Northing'),
  };
}

export function lccInverse(p: LccParams) {
  const rad = Math.PI / 180;
  const f = 1 / p.invF;
  const e = Math.sqrt(2 * f - f * f);
  const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - (e * Math.sin(phi)) ** 2);
  const t = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
  const [p1, p2, p0] = [p.lat1 * rad, p.lat2 * rad, p.lat0 * rad];
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  const rho0 = p.a * F * t(p0) ** n;
  return ([x, y]: [number, number]): Coord => {
    const dx = x - p.fe;
    const dy = rho0 - (y - p.fn);
    const rho = Math.sign(n) * Math.hypot(dx, dy);
    const tt = (rho / (p.a * F)) ** (1 / n);
    const theta = Math.atan2(Math.sign(n) * dx, Math.sign(n) * dy);
    let phi = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 15; i++) {
      const next = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
      if (Math.abs(next - phi) < 1e-12) {
        phi = next;
        break;
      }
      phi = next;
    }
    return [theta / n / rad + p.lon0, phi / rad];
  };
}

// ---------------------------------------------------------------------------
// Índice de localidades
// ---------------------------------------------------------------------------

export interface Place {
  nombre: string;
  cvegeo: string;
  municipio: string;
  ambito: string;
  tipo: 'poligono' | 'punto';
  rings?: Coord[][];
  point?: Coord;
  bbox: [number, number, number, number];
}

export interface PlaceHit {
  nombre: string;
  municipio: string;
  cvegeo: string;
  tipo: 'poligono' | 'punto';
  /** El extremo cae dentro del polígono de la localidad. */
  dentro: boolean;
  distanciaM: number;
}

function bboxOf(points: Coord[]): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Par/impar sobre todos los anillos: respeta huecos. */
function inside([x, y]: Coord, rings: Coord[][]) {
  let ins = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
  }
  return ins;
}

function distToRings(c: Coord, rings: Coord[][]) {
  const { toXY } = projector(c[1]);
  const [px, py] = toXY(c);
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = toXY(ring[i - 1]);
      const [bx, by] = toXY(ring[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(ax + dx * t - px, ay + dy * t - py));
    }
  }
  return best;
}

export class PlaceIndex {
  constructor(
    readonly places: Place[],
    private readonly municipios: { nombre: string; rings: Coord[][]; bbox: Place['bbox'] }[],
  ) {}

  /** Localidades a ≤ maxM del punto, de la más cercana a la más lejana (dentro = 0 m). */
  near(c: Coord, maxM: number, k = 3): PlaceHit[] {
    const dLat = maxM / 110_540;
    const dLng = maxM / (111_320 * Math.cos((c[1] * Math.PI) / 180));
    const hits: PlaceHit[] = [];
    for (const p of this.places) {
      const [x0, y0, x1, y1] = p.bbox;
      if (c[0] < x0 - dLng || c[0] > x1 + dLng || c[1] < y0 - dLat || c[1] > y1 + dLat) continue;
      let dist: number;
      let dentro = false;
      if (p.rings) {
        dentro = inside(c, p.rings);
        dist = dentro ? 0 : distToRings(c, p.rings);
      } else {
        const { toXY } = projector(c[1]);
        const [ax, ay] = toXY(c);
        const [bx, by] = toXY(p.point!);
        dist = Math.hypot(ax - bx, ay - by);
      }
      if (dist <= maxM) hits.push({ nombre: p.nombre, municipio: p.municipio, cvegeo: p.cvegeo, tipo: p.tipo, dentro, distanciaM: Math.round(dist) });
    }
    // Una localidad puede venir como polígono y como punto: se deja la más cercana (clave = ent+mun+loc)
    const seen = new Set<string>();
    return hits
      .sort((a, b) => a.distanciaM - b.distanciaM || a.nombre.localeCompare(b.nombre))
      .filter((h) => !seen.has(h.cvegeo.slice(0, 9)) && !!seen.add(h.cvegeo.slice(0, 9)))
      .slice(0, k);
  }

  municipioDe(c: Coord): string | undefined {
    return this.municipios.find((m) => c[0] >= m.bbox[0] && c[0] <= m.bbox[2] && c[1] >= m.bbox[1] && c[1] <= m.bbox[3] && inside(c, m.rings))?.nombre;
  }

  /** Localidades cuyo nombre normalizado coincide con el texto. */
  byName(name: string): Place[] {
    const n = normalize(name);
    return this.places.filter((p) => normalize(p.nombre) === n);
  }
}

/** Capas del Marco Geoestadístico que se leen (todas deben estar en la carpeta). */
export const INEGI_CAPAS = ['17l', '17lpr', '17mun'];

export function loadInegi(dir: string): PlaceIndex {
  const file = (base: string, ext: string) => join(dir, `${base}.${ext}`);
  for (const base of INEGI_CAPAS) {
    if (!existsSync(file(base, 'shp'))) throw new Error(`No se encontró ${file(base, 'shp')}`);
  }
  const toLngLat = lccInverse(parsePrj(readFileSync(file('17l', 'prj'), 'utf8')));
  const load = (base: string) => {
    const geoms = readShp(readFileSync(file(base, 'shp')));
    const rows = readDbf(readFileSync(file(base, 'dbf')));
    return geoms.map((g, i) => ({ g, row: rows[i] })).filter((x) => x.g && x.row && !x.row.__borrado);
  };

  const municipios = load('17mun').map(({ g, row }) => {
    const rings = (g as Extract<ShpGeom, { type: 'polygon' }>).rings.map((r) => r.map(toLngLat));
    return { nombre: row.NOMGEO, cve: row.CVE_MUN, rings, bbox: bboxOf(rings.flat()) };
  });
  const munName = new Map(municipios.map((m) => [m.cve, m.nombre]));

  const places: Place[] = [];
  for (const { g, row } of load('17l')) {
    if (g!.type !== 'polygon') continue;
    const rings = g!.rings.map((r) => r.map(toLngLat));
    places.push({
      nombre: row.NOMGEO,
      cvegeo: row.CVEGEO,
      municipio: munName.get(row.CVE_MUN) ?? '',
      ambito: row.AMBITO,
      tipo: 'poligono',
      rings,
      bbox: bboxOf(rings.flat()),
    });
  }
  for (const { g, row } of load('17lpr')) {
    if (g!.type !== 'point') continue;
    const point = toLngLat(g!.xy);
    places.push({
      nombre: row.NOMGEO,
      cvegeo: row.CVEGEO,
      municipio: munName.get(row.CVE_MUN) ?? '',
      ambito: 'Rural',
      tipo: 'punto',
      point,
      bbox: [point[0], point[1], point[0], point[1]],
    });
  }
  return new PlaceIndex(places, municipios);
}
