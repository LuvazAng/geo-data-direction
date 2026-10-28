import { normalize } from '@core';

// Comparación de nombres de lugares escritos a mano: sin acentos ni mayúsculas, sin
// palabras genéricas (COL., U.H., LA…), números como palabra (30 = TREINTA) y una letra
// de diferencia en palabras largas (TILZPOTLA = TILZAPOTLA).

const STOP = new Set([
  'COL',
  'COLONIA',
  'U',
  'H',
  'UH',
  'HAB',
  'UNIDAD',
  'HABITACIONAL',
  'FRACC',
  'FRACCIONAMIENTO',
  'LA',
  'EL',
  'LOS',
  'LAS',
  'DE',
  'DEL',
  'Y',
  'X',
  'POR',
  'VIA',
  'BARRIO',
  'BO',
  'CIRCUITO',
]);

const UNITS = [
  'CERO',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISEIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
  'VEINTIUNO',
  'VEINTIDOS',
  'VEINTITRES',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISEIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];
const TENS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];

export function numberWord(n: number): string {
  if (n < 30) return UNITS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` Y ${UNITS[n % 10]}` : '');
  return String(n);
}

/** Palabras significativas del nombre, con los números escritos con letra. */
export function tokens(name: string, alias: Record<string, string> = {}): string[] {
  let n = normalize(name);
  n = alias[n] ? normalize(alias[n]) : n;
  return n
    .split(' ')
    .flatMap((w) => (/^\d+$/.test(w) && Number(w) < 100 ? numberWord(Number(w)).split(' ') : [w]))
    .filter((w) => w && !STOP.has(w));
}

function lev1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 6) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const has = (list: string[], w: string) => list.some((x) => lev1(x, w));

/**
 * ¿El lugar `a` es el mismo que `b`? El nombre más corto debe ser el principio del otro,
 * palabra por palabra o con las palabras pegadas: "JOJUTLA" = "Jojutla de Juárez",
 * "SANTA ROSA 30" = "Santa Rosa Treinta", "ALTAVISTA" = "ALTA VISTA POR ARRIBA";
 * pero "JOJUTLA" ≠ "Campo Jojutla" y "SAN" ≠ "SANTA".
 */
export function samePlace(a: string, b: string, alias: Record<string, string> = {}): boolean {
  const ta = tokens(a, alias);
  const tb = tokens(b, alias);
  if (!ta.length || !tb.length) return normalize(a) === normalize(b) && !!normalize(a);
  const [short, long] = ta.join('').length <= tb.join('').length ? [ta, tb] : [tb, ta];
  if (short.length <= long.length && short.every((w, i) => lev1(w, long[i]))) return true;
  const joined = short.join('');
  for (let k = 1; k <= long.length; k++) {
    const prefix = long.slice(0, k).join('');
    if (prefix.length >= joined.length - 1 && lev1(prefix, joined)) return true;
    if (prefix.length > joined.length + 1) break;
  }
  return false;
}

/** El texto menciona el lugar (todas sus palabras aparecen en el texto). */
export function mentions(text: string, place: string, alias: Record<string, string> = {}): boolean {
  const tp = tokens(place, alias);
  const tt = tokens(text, alias);
  return tp.length > 0 && tp.every((w) => has(tt, w));
}

/** Misma clave de catálogo salvo una letra (OTILIO MONTAÑOS = OTILIO MONTAÑO, CHCAMPALCO = CHACAMPALCO). */
export const sameKey = (a: string, b: string) => a === b || lev1(a.replace(/ /g, ''), b.replace(/ /g, ''));

/**
 * ¿El código es una abreviatura del nombre? Sus letras aparecen en orden dentro del nombre y
 * empieza como alguna de sus palabras: IXT ~ PUENTE DE IXTLA, PZONDA ~ POZA HONDA, JOJU ~ JOJUTLA.
 */
export function abbreviates(code: string, name: string): boolean {
  const ws = tokens(name);
  const flat = ws.join('');
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!c || !ws.some((w) => w[0] === c[0])) return false;
  let i = 0;
  for (const ch of flat) if (ch === c[i]) i++;
  return i === c.length;
}

/** Clave estable para agrupar variantes de un mismo "por dónde pasa": "X LAS GAS" = "LA GAS" = "GAS". */
export const viaKey = (via: string | null | undefined) => (via ? tokens(via).join(' ') : '');
