import type { Address } from './geocode';
import type { Coord, ParsedKml } from '@core';
import type { SourceFile } from './files';
import { flipOneways, type OnewayResult } from './oneway';

export type OnewayState =
  | { state: 'loading' }
  /** `base`: geometría (orden del archivo) sobre la que se calculó. */
  | { state: 'ok'; result: OnewayResult; base: Coord[] }
  | { state: 'error'; message: string };

export type AddrState = { state: 'loading' } | { state: 'ok'; address: Address } | { state: 'error'; message: string };

export interface Route {
  id: string;
  letter: string;
  color: string;
  source: SourceFile;
  parsed: ParsedKml;
  /** true = el trazo se exportará en orden inverso al del archivo. */
  reversed: boolean;
  /** Geometría editada (simplificada o con vértices movidos), en el orden del archivo. */
  edited?: Coord[];
  /** Geometrías anteriores, para deshacer (orden del archivo). */
  history?: Coord[][];
  outName: string;
  /** Carpeta del trazo en la app; al guardar es la subcarpeta destino, relativa a la carpeta del archivo. */
  folder: string;
  visible: boolean;
  /** Opacidad en el mapa (0.1–1, sin definir = 1). Sólo visual: no se escribe en el KML. */
  opacity?: number;
  /** Ruta alterna generada a partir de una principal + un tramo corto. */
  alt?: { mainId: string; shortId: string };
  /** Direcciones del primer y último punto de la geometría base (orden del archivo). */
  addrFirst?: AddrState;
  addrLast?: AddrState;
  oneway?: OnewayState;
  /** Geometría base para la que ya se pidieron direcciones y calles de un sentido. */
  derivedFor?: Coord[];
  saved?: string;
}

/** Geometría vigente en el orden del archivo. */
export const baseCoords = (r: Route): Coord[] => r.edited ?? r.parsed.coords;

const reversedCache = new WeakMap<Coord[], Coord[]>();
/** Geometría vigente tal como se exportará (ya orientada). */
export function coordsOf(r: Route): Coord[] {
  const base = baseCoords(r);
  if (!r.reversed) return base;
  let c = reversedCache.get(base);
  if (!c) reversedCache.set(base, (c = [...base].reverse()));
  return c;
}

export const startAddr = (r: Route) => (r.reversed ? r.addrLast : r.addrFirst);
export const endAddr = (r: Route) => (r.reversed ? r.addrFirst : r.addrLast);

/** Resultado de calles de un sentido para el trayecto tal como se exportará (si está al día). */
export function onewayOf(r: Route): OnewayResult | undefined {
  if (r.oneway?.state !== 'ok' || r.oneway.base !== baseCoords(r)) return undefined;
  return r.reversed ? flipOneways(r.oneway.result) : r.oneway.result;
}
