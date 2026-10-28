import type { Coord } from './kml';
import { normalize } from './analysis';
import { projector } from './geometry';

// Colonias, barrios, fraccionamientos, pueblos… de Morelos (INE, Base Geográfica Digital, en
// GEODATA/INE_BGD_2025). `npm run colonias` las convierte a GeoJSON para el editor; aquí está lo
// que comparten el editor y el orquestador: índice espacial, por qué colonias pasa un trazo y el
// texto que se escribe en el KML.

export const COLONIAS_URL = '/datos/colonias-morelos.geojson';

export interface ColoniaProps {
  id: number;
  nombre: string;
  /** Colonia, Barrio, Fraccionamiento, Pueblo… (catálogo del INE); vacío si no tiene. */
  tipo: string;
  municipio: string;
  cp: string;
}

export type ColoniaGeometry = { type: 'Polygon'; coordinates: Coord[][] } | { type: 'MultiPolygon'; coordinates: Coord[][][] };

export interface ColoniaFeature {
  type: 'Feature';
  properties: ColoniaProps;
  geometry: ColoniaGeometry;
}

export interface ColoniasData {
  type: 'FeatureCollection';
  fuente: string;
  features: ColoniaFeature[];
}

export interface ColoniaPaso {
  colonia: ColoniaProps;
  /**
   * Polígonos que cruza con ese mismo tipo, nombre y municipio: el INE parte algunas colonias en
   * varios, y en un municipio puede haber dos con el mismo nombre (se listan una vez).
   */
  ids: number[];
  /** Metros del trazo dentro de la colonia (en una calle que es su límite, cuenta para las dos). */
  metros: number;
  /** Distancia desde el inicio del trazo hasta donde entra por primera vez. */
  desdeM: number;
}

export interface ColoniasRuta {
  /** En el orden en que el trazo entra a cada una. */
  pasos: ColoniaPaso[];
  /** Metros fuera de toda colonia (tramos carreteros, campo). */
  fueraM: number;
  totalM: number;
}

/** Colonias en las que el trazo recorre menos que esto (esquinas, cruces) no se listan. */
export const MIN_COLONIA_M = 50;
/** Cada cuánto se revisa en qué colonia va el trazo. */
const STEP_M = 10;
/** Celda del índice espacial (~500 m). */
const CELL = 0.005;

type BBox = [number, number, number, number];

/** Par/impar sobre los anillos de un polígono: respeta huecos. */
function inPolygon([x, y]: Coord, rings: Coord[][]) {
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

export class ColoniaIndex {
  private readonly items: { props: ColoniaProps; polygons: Coord[][][]; bbox: BBox }[];
  private readonly grid = new Map<string, number[]>();

  constructor(readonly data: ColoniasData) {
    this.items = data.features.map((f) => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of polygons.flat(2)) {
        bbox[0] = Math.min(bbox[0], x);
        bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x);
        bbox[3] = Math.max(bbox[3], y);
      }
      return { props: f.properties, polygons, bbox };
    });
    this.items.forEach(({ bbox }, i) => {
      for (let cx = Math.floor(bbox[0] / CELL); cx <= Math.floor(bbox[2] / CELL); cx++) {
        for (let cy = Math.floor(bbox[1] / CELL); cy <= Math.floor(bbox[3] / CELL); cy++) {
          const key = `${cx}:${cy}`;
          const cell = this.grid.get(key);
          if (cell) cell.push(i);
          else this.grid.set(key, [i]);
        }
      }
    });
  }

  /** Colonias que contienen el punto: normalmente una; más si los polígonos se enciman. */
  at(c: Coord): ColoniaProps[] {
    const cell = this.grid.get(`${Math.floor(c[0] / CELL)}:${Math.floor(c[1] / CELL)}`) ?? [];
    return cell
      .map((i) => this.items[i])
      .filter(({ bbox, polygons }) => c[0] >= bbox[0] && c[0] <= bbox[2] && c[1] >= bbox[1] && c[1] <= bbox[3] && polygons.some((p) => inPolygon(c, p)))
      .map((it) => it.props);
  }
}

/** Colonias por las que pasa el trazo, en orden, con los metros que recorre en cada una. */
export function coloniasAlong(coords: Coord[], index: ColoniaIndex, minM = MIN_COLONIA_M): ColoniasRuta {
  const byKey = new Map<string, ColoniaPaso>();
  let fueraM = 0;
  let totalM = 0;
  if (coords.length < 2) return { pasos: [], fueraM, totalM };
  const { toXY } = projector(coords[0][1]);
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / STEP_M));
    // cada pedazo se asigna a la colonia en la que cae su punto medio
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const hits = index.at([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      const piece = len / n;
      if (hits.length === 0) fueraM += piece;
      for (const colonia of hits) {
        const key = `${colonia.tipo}|${colonia.nombre}|${colonia.municipio}`;
        const paso = byKey.get(key);
        if (!paso) byKey.set(key, { colonia, ids: [colonia.id], metros: piece, desdeM: totalM + piece * k });
        else {
          paso.metros += piece;
          if (!paso.ids.includes(colonia.id)) paso.ids.push(colonia.id);
        }
      }
    }
    totalM += len;
  }
  const pasos = [...byKey.values()].filter((p) => p.metros >= minM).sort((x, y) => x.desdeM - y.desdeM);
  return { pasos, fueraM, totalM };
}

/** Cuánto del principio (o del final) del trazo se mira si su extremo no cae dentro de ninguna colonia. */
const ENDPOINT_WINDOW_M = 400;

/** Los primeros metros del trazo: los vértices hasta juntar `meters` metros. */
function headOf(coords: Coord[], meters: number): Coord[] {
  const { toXY } = projector(coords[0][1]);
  const head = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length && acc < meters; i++) {
    const [ax, ay] = toXY(coords[i - 1]);
    const [bx, by] = toXY(coords[i]);
    acc += Math.hypot(bx - ax, by - ay);
    head.push(coords[i]);
  }
  return head;
}

/** La colonia en la que empieza el trazo: la que contiene su primer punto o, si cae fuera de todas, en la que más recorre al empezar. */
function coloniaAtStart(coords: Coord[], index: ColoniaIndex): ColoniaProps | null {
  const hit = index.at(coords[0]);
  if (hit.length) return hit[0];
  const near = coloniasAlong(headOf(coords, ENDPOINT_WINDOW_M), index, 0);
  return [...near.pasos].sort((a, b) => b.metros - a.metros)[0]?.colonia ?? null;
}

/** La colonia donde empieza y la colonia donde termina el trazo (en el sentido en que va); null si ese extremo no cae en ninguna. */
export function endpointColonias(coords: Coord[], index: ColoniaIndex): { inicio: ColoniaProps | null; final: ColoniaProps | null } {
  if (coords.length < 2) return { inicio: null, final: null };
  return { inicio: coloniaAtStart(coords, index), final: coloniaAtStart([...coords].reverse(), index) };
}

/** Nombre con su tipo («BARRIO SAN JUAN»), sin repetirlo si el nombre ya lo trae («AMPLIACION LAZARO CARDENAS»). */
export function coloniaNombre(c: ColoniaProps): string {
  const tipo = normalize(c.tipo);
  return !tipo || normalize(c.nombre).startsWith(tipo + ' ') ? c.nombre : `${c.tipo.toUpperCase()} ${c.nombre}`;
}

/** Valor del campo COLONIAS del KML: «COLONIA CENTRO, JOJUTLA; BARRIO SAN JUAN, JOJUTLA». */
export const coloniasKml = (r: ColoniasRuta) => r.pasos.map((p) => `${coloniaNombre(p.colonia)}, ${p.colonia.municipio}`).join('; ');

/** Carga el GeoJSON que genera `npm run colonias` (servido desde public/). */
export async function fetchColonias(url = COLONIAS_URL): Promise<ColoniaIndex> {
  const missing = 'no se encontró el archivo de colonias; ejecuta «npm run colonias»';
  const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? missing : `el archivo de colonias respondió ${res.status}`);
  let data: ColoniasData;
  try {
    data = await res.json();
  } catch {
    // sin el archivo, el servidor de desarrollo puede responder con la página de la app
    throw new Error(missing);
  }
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(missing);
  return new ColoniaIndex(data);
}
