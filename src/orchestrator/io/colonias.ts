import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Coord, ColoniaIndex, type ColoniaFeature, type ColoniaGeometry, type ColoniasData } from '@core';
import { readDbf, readShp, type ShpGeom } from './inegi';

// Colonias del INE (Base Geográfica Digital) ya descargadas en GEODATA/INE_BGD_2025/17_morelos:
//   COLONIA   polígonos de colonias, barrios, fraccionamientos… (DBF en ISO-8859-1, sin .cpg)
//   MUNICIPIO municipios, sólo para el nombre (DBF en UTF-8)
// Vienen en UTM 14N (WGS84). Se pasan a longitud/latitud y a GeoJSON válido (cada anillo exterior
// con sus huecos) para el editor (`npm run colonias`) y para el orquestador.

/** Catálogo Cat_clasificación_colonia del Manual de Digitalización Cartográfica del INE. */
export const TIPOS_COLONIA: Record<number, string> = {
  1: 'Colonia',
  2: 'Fraccionamiento',
  3: 'Unidad habitacional',
  4: 'Conjunto habitacional',
  5: 'Pueblo',
  6: 'Rancho',
  7: 'Barrio',
  8: 'Ejido',
  9: 'Hacienda',
  10: 'Ampliación',
  11: 'Cantón',
  12: 'Ciudad industrial',
  13: 'Condominio',
  14: 'Corredor industrial',
  15: 'Cuartel',
  16: 'Ex-hacienda',
  17: 'Fracción',
  18: 'Granja',
  19: 'Manzana',
  20: 'Paraje',
  21: 'Parque industrial',
  22: 'Región',
  23: 'Residencial',
  24: 'Rinconada',
  25: 'Sección',
  26: 'Sector',
  28: 'Supermanzana',
  29: 'Unidad',
  30: 'Villa',
  31: 'Zona industrial',
  32: 'Zona militar',
  33: 'Zona federal',
  34: 'Ciudad',
  35: 'Localidad',
  36: 'Privada',
  37: 'Prolongación',
  38: 'Puerto',
  39: 'Ranchería',
};

// ---------------------------------------------------------------------------
// Transversa de Mercator inversa (UTM), elipsoide — Snyder, "Map Projections: A Working Manual"
// ---------------------------------------------------------------------------

export interface TmParams {
  a: number;
  invF: number;
  lat0: number;
  lon0: number;
  k0: number;
  fe: number;
  fn: number;
}

export function parseTmPrj(prj: string): TmParams {
  if (!/Transverse_Mercator/i.test(prj)) throw new Error('Proyección no soportada (se esperaba Transverse_Mercator)');
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
    k0: param('Scale_Factor'),
    fe: param('False_Easting'),
    fn: param('False_Northing'),
  };
}

export function tmInverse(p: TmParams) {
  const rad = Math.PI / 180;
  const f = 1 / p.invF;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const m = (phi: number) =>
    p.a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const m0 = m(p.lat0 * rad);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  return ([x, y]: [number, number]): Coord => {
    const mu = (m0 + (y - p.fn) / p.k0) / (p.a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
    const phi1 =
      mu +
      ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
      ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
      ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
      ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const [sin1, cos1, tan1] = [Math.sin(phi1), Math.cos(phi1), Math.tan(phi1)];
    const c1 = ep2 * cos1 ** 2;
    const t1 = tan1 ** 2;
    const n1 = p.a / Math.sqrt(1 - e2 * sin1 ** 2);
    const r1 = (p.a * (1 - e2)) / (1 - e2 * sin1 ** 2) ** 1.5;
    const d = (x - p.fe) / (n1 * p.k0);
    const phi =
      phi1 -
      ((n1 * tan1) / r1) *
        (d ** 2 / 2 -
          ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
          ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);
    const lon = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) / cos1;
    return [p.lon0 + lon / rad, phi / rad];
  };
}

// ---------------------------------------------------------------------------
// Polígonos del shapefile → GeoJSON
// ---------------------------------------------------------------------------

/** Área con signo (positiva = antihoraria). */
const signedArea = (ring: Coord[]) => ring.reduce((s, [x1, y1], i) => (i ? s + (ring[i - 1][0] - x1) * (ring[i - 1][1] + y1) : s), 0) / 2;

function inRing([x, y]: Coord, ring: Coord[]) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * En el shapefile los anillos exteriores van en sentido horario y los huecos al revés. En GeoJSON
 * (RFC 7946) es al contrario y cada hueco va con su exterior.
 */
export function toGeometry(rings: Coord[][]): ColoniaGeometry | null {
  const clean = rings
    .map((r) => r.map(([x, y]): Coord => [round6(x), round6(y)]).filter((c, i, a) => i === 0 || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1]))
    .filter((r) => r.length >= 4);
  const polygons: Coord[][][] = [];
  const holes: Coord[][] = [];
  for (const r of clean) {
    if (signedArea(r) < 0) polygons.push([[...r].reverse()]);
    else holes.push(r);
  }
  for (const h of holes) {
    const owner = polygons.find((p) => inRing(h[0], p[0]));
    // un "hueco" que no cae en ningún exterior se toma como exterior (anillo mal orientado)
    if (owner) owner.push([...h].reverse());
    else polygons.push([h]);
  }
  if (polygons.length === 0) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

/** Busca `<base>.<ext>` sin importar mayúsculas (el INE mezcla COLONIA.DBF y MUNICIPIO.dbf). */
export function fileIn(dir: string, base: string, ext: string): string | undefined {
  const want = `${base}.${ext}`.toLowerCase();
  const name = readdirSync(dir).find((n) => n.toLowerCase() === want);
  return name && join(dir, name);
}

function readLayer(dir: string, base: string) {
  const need = (ext: string) => {
    const path = fileIn(dir, base, ext);
    if (!path) throw new Error(`No se encontró ${join(dir, `${base}.${ext}`)}`);
    return path;
  };
  const cpg = fileIn(dir, base, 'cpg');
  const encoding: BufferEncoding = cpg && /utf-?8/i.test(readFileSync(cpg, 'utf8')) ? 'utf8' : 'latin1';
  const toLngLat = tmInverse(parseTmPrj(readFileSync(need('prj'), 'utf8')));
  const geoms = readShp(readFileSync(need('shp')));
  const rows = readDbf(readFileSync(need('dbf')), encoding);
  return { toLngLat, items: geoms.map((g, i) => ({ g, row: rows[i] })).filter((x) => x.g && x.row && !x.row.__borrado) };
}

const polygonRings = (g: ShpGeom, toLngLat: (xy: [number, number]) => Coord) => (g?.type === 'polygon' ? g.rings.map((r) => r.map(toLngLat)) : []);

/** Lee COLONIA y MUNICIPIO de la Base Geográfica Digital del INE. */
export function loadColoniasIne(dir: string): ColoniasData {
  if (!existsSync(dir)) throw new Error(`No existe la carpeta de colonias: ${dir}`);
  const municipios = new Map(readLayer(dir, 'MUNICIPIO').items.map(({ row }) => [Number(row.municipio ?? row.MUNICIPIO), row.nombre ?? row.NOMBRE]));
  const { toLngLat, items } = readLayer(dir, 'COLONIA');
  const features: ColoniaFeature[] = [];
  for (const { g, row } of items) {
    const geometry = toGeometry(polygonRings(g, toLngLat));
    if (!geometry) continue;
    const cp = Number(row.CP) > 0 ? row.CP : '';
    features.push({
      type: 'Feature',
      properties: {
        id: Number(row.ID),
        nombre: row.NOMBRE.replace(/\s+/g, ' '),
        tipo: TIPOS_COLONIA[Number(row.CLASIFICAC)] ?? '',
        municipio: municipios.get(Number(row.MUNICIPIO)) ?? '',
        cp,
      },
      geometry,
    });
  }
  return { type: 'FeatureCollection', fuente: 'INE, Base Geográfica Digital', features };
}

const indexes = new Map<string, ColoniaIndex>();

/** Índice de colonias de la carpeta (se lee una sola vez por proceso). */
export function coloniaIndexFor(dir: string): ColoniaIndex {
  const key = resolve(dir);
  let index = indexes.get(key);
  if (!index) indexes.set(key, (index = new ColoniaIndex(loadColoniasIne(key))));
  return index;
}
