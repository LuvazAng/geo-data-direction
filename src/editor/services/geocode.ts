import type { Coord } from '@core';

export interface Address {
  calle?: string;
  colonia?: string;
  localidad?: string;
  municipio?: string;
  /** Todo el texto devuelto, para buscar coincidencias con la descripción. */
  full: string;
}

const CACHE_KEY = 'geo-direction:nominatim:v1';
const MIN_INTERVAL_MS = 1100; // Política de uso de Nominatim: máx. 1 petición/segundo

let cache: Record<string, Address> = {};
try {
  cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
} catch {
  cache = {};
}

const persist = () => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* sin almacenamiento disponible: sólo se pierde la caché */
  }
};

let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function reverseGeocode([lng, lat]: Coord): Promise<Address> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache[key]) return Promise.resolve(cache[key]);

  const task = queue.then(async () => {
    if (cache[key]) return cache[key];
    const delay = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastRequest = Date.now();
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1` + `&accept-language=es&lat=${lat}&lon=${lng}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
    const data = await res.json();
    const a = data.address ?? {};
    const address: Address = {
      calle: a.road ?? a.pedestrian ?? a.footway ?? a.highway,
      colonia: a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? a.hamlet,
      localidad: a.village ?? a.town ?? a.city ?? a.city_district,
      municipio: a.county ?? a.municipality ?? a.city ?? a.town,
      full: [data.display_name, ...Object.values(a)].join(' | '),
    };
    cache[key] = address;
    persist();
    return address;
  });
  queue = task.catch(() => undefined);
  return task;
}

export const formatAddress = (a?: Address) =>
  a ? [a.calle, a.colonia, a.localidad !== a.municipio ? a.localidad : undefined, a.municipio].filter(Boolean).join(', ') : '';
