import type { Coord } from '@core';

// Cliente de Overpass (OpenStreetMap) con caché por mosaicos de 0.005° (~550 m): el regreso
// de un trayecto, y las rutas vecinas, reutilizan casi todo lo ya descargado.

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export interface OverpassJson {
  elements?: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
}

export interface OsmWay {
  id: number;
  coords: Coord[];
}

async function overpass(query: string): Promise<OverpassJson> {
  let lastError: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
      const json = await res.json();
      // Overpass responde 200 con "remark" cuando la consulta se agota en el servidor
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(json.remark);
      return json;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

const TILE_DEG = 0.005;

const tileOf = (lng: number, lat: number) => `${Math.floor(lng / TILE_DEG)},${Math.floor(lat / TILE_DEG)}`;

/** Mosaicos que tocan el corredor de `radiusM` alrededor del trazo. */
function corridorTiles(coords: Coord[], radiusM: number): string[] {
  const padLat = radiusM / 110_540;
  const padLng = radiusM / (111_320 * Math.cos((coords[0][1] * Math.PI) / 180));
  const keys = new Set<string>();
  const add = ([lng, lat]: Coord) => {
    for (const dx of [-padLng, 0, padLng]) for (const dy of [-padLat, 0, padLat]) keys.add(tileOf(lng + dx, lat + dy));
  };
  coords.forEach((c, i) => {
    add(c);
    if (i === 0) return;
    // puntos intermedios para segmentos largos (carreteras con pocos vértices)
    const [plng, plat] = coords[i - 1];
    const n = Math.ceil(Math.max(Math.abs(c[0] - plng), Math.abs(c[1] - plat)) / (TILE_DEG / 4));
    for (let k = 1; k < n; k++) add([plng + ((c[0] - plng) * k) / n, plat + ((c[1] - plat) * k) / n]);
  });
  return [...keys];
}

/** Avance de una descarga: lotes de mosaicos ya descargados de `total` (0 = todo estaba en caché). */
export type Progress = (done: number, total: number) => void;

const BATCH = 30;

/**
 * Descargador de vías alrededor de un trazo, con su propia caché por mosaico y cola (una
 * consulta a la vez). `statements(bbox)` da las sentencias Overpass de un mosaico
 * ("sur,oeste,norte,este") y `parse` convierte la respuesta en vías.
 */
export function tiledWays<T extends OsmWay>(
  radiusM: number,
  statements: (bbox: string) => string,
  parse: (json: OverpassJson) => T[],
): (coords: Coord[], onProgress?: Progress) => Promise<T[]> {
  const wayById = new Map<number, T>();
  const tileWays = new Map<string, number[]>();
  let queue: Promise<unknown> = Promise.resolve();

  async function loadTiles(keys: string[]) {
    const body = keys
      .map((k) => {
        const [x, y] = k.split(',').map(Number);
        return statements([y * TILE_DEG, x * TILE_DEG, (y + 1) * TILE_DEG, (x + 1) * TILE_DEG].map((v) => v.toFixed(4)).join(','));
      })
      .join('\n');
    const ways = parse(
      await overpass(`[out:json][timeout:90];
(
${body}
);
out tags geom;`),
    );
    for (const k of keys) tileWays.set(k, []);
    for (const way of ways) {
      wayById.set(way.id, way);
      for (const k of new Set(way.coords.map(([lng, lat]) => tileOf(lng, lat)))) tileWays.get(k)?.push(way.id);
    }
  }

  return (coords, onProgress) => {
    const task = queue.then(async () => {
      const keys = corridorTiles(coords, radiusM);
      const missing = keys.filter((k) => !tileWays.has(k));
      // lotes para no mandar consultas gigantes en rutas largas
      const total = Math.ceil(missing.length / BATCH);
      onProgress?.(0, total);
      for (let i = 0; i < total; i++) {
        await loadTiles(missing.slice(i * BATCH, (i + 1) * BATCH));
        onProgress?.(i + 1, total);
      }
      const ids = new Set(keys.flatMap((k) => tileWays.get(k) ?? []));
      return [...ids].map((id) => wayById.get(id)!).filter(Boolean);
    });
    queue = task.catch(() => undefined);
    return task;
  };
}
