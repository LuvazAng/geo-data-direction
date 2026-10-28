import { normalize } from '@core';
import type { OrqConfig } from '../config';
import { placeKey } from './labeled';
import { sameKey } from './places';
import type { CodeSource } from '@protocol';

// Nombres de salida. El backend construye y valida el nombre definitivo con las reglas
// configuradas; la IA no decide nombres.

export interface RouteCode {
  codigo: string;
  carpeta: string;
  origen: CodeSource;
  nota?: string;
}

const STOP = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'COL', 'COLONIA', 'U', 'H', 'UH', 'HAB', 'X', 'POR']);
const CODE_RE = /^[A-Z0-9_]{1,12}$/;

/** Carpeta con el estilo de GEODATA/RUTAS: el slug en mayúsculas y sin acentos (RUTA-1-SUR). */
export const folderOf = (slug: string) =>
  slug
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const words = (s: string) =>
  normalize(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w));

/** Letras para distinguir variantes con el mismo número ("ahuehuetzingo" → AH, "pedro amaro…" → PA). */
function distinguisher(rest: string) {
  const ws = words(rest).filter((w) => !/^\d+$/.test(w) && w !== 'SUR' && w !== 'ORIENTE' && w !== 'CENTRO');
  if (ws.length === 0) return '';
  return ws.length === 1
    ? ws[0].slice(0, 2)
    : ws
        .slice(0, 2)
        .map((w) => w[0])
        .join('');
}

/**
 * Código de ruta de una subpágina:
 *  1. el de la configuración (nomenclatura.rutas[slug].codigo), si existe;
 *  2. si no, R + número (+ letra: 5A, 11B) y, si hay otra subpágina de la zona con el mismo número,
 *     unas letras del nombre (sugeridas: revisar);
 *  3. grupos sin número: nomenclatura.rutasBase o las iniciales (sugeridas);
 *  4. si ese número (o código) ya existe en otra zona, se agrega la letra de la zona (SUR = S, ORIENTE = O).
 */
export function routeCodeFor(slug: string, zoneSlugs: string[], cfg: OrqConfig, other: { numbers: Set<string>; codes: Set<string> }): RouteCode {
  const n = cfg.nomenclatura;
  const carpeta = n.rutas[slug]?.carpeta ?? folderOf(slug);
  const fixed = n.rutas[slug]?.codigo;
  if (fixed) return { codigo: fixed, carpeta, origen: 'config' };

  const zoneSuffix = new RegExp(`-${cfg.zona.toLowerCase()}$`);
  const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(zoneSuffix, '');
  const base = clean(slug);
  const letter = n.letraZona[cfg.zona.toUpperCase()] ?? '';
  const m = /^ruta-(\d+)([a-z]?)(?:-(.+))?$/.exec(base);

  if (m) {
    const [, num, sub, rest = ''] = m;
    const same = zoneSlugs.filter((s) => {
      const o = /^ruta-(\d+)([a-z]?)(?:-|$)/.exec(clean(s));
      return o && o[1] === num && o[2] === sub;
    });
    let codigo = `R${Number(num)}${sub.toUpperCase()}`;
    let origen: CodeSource = 'regla';
    let nota: string | undefined;
    if (same.length > 1 && same[0] !== slug) {
      const d = distinguisher(rest);
      codigo += d;
      origen = 'sugerido';
      nota = `hay ${same.length} subpáginas con la ruta ${num}${sub.toUpperCase()} en ${cfg.zona}: se agregó "${d}" para distinguirla`;
    }
    if (other.numbers.has(String(Number(num))) && letter) {
      codigo += letter;
      nota = [nota, `la ruta ${Number(num)} ya existe en otra zona: se agregó "${letter}"`].filter(Boolean).join('; ');
    }
    return { codigo, carpeta, origen, nota };
  }

  const key = normalize(base.replace(/-/g, ' '));
  const known = Object.entries(n.rutasBase).find(([k]) => normalize(k) === key)?.[1];
  // una palabra → sus 3 primeras letras (INTERESCOLAR → INT); varias → iniciales (sin "RUTA")
  const ws = words(key).filter((w) => w !== 'RUTA');
  let codigo = known ?? (ws.length === 1 ? ws[0].slice(0, 3) : ws.map((w) => (/^\d+$/.test(w) ? w : w[0])).join(''));
  const origen: CodeSource = known ? 'regla' : 'sugerido';
  let nota = known ? undefined : `grupo sin número: iniciales sugeridas (configurar en nomenclatura.rutasBase o nomenclatura.rutas)`;
  if (other.codes.has(codigo) && letter) {
    codigo += letter;
    nota = [nota, `el código ${codigo.slice(0, -letter.length)} ya existe en otra zona: se agregó "${letter}"`].filter(Boolean).join('; ');
  }
  return { codigo, carpeta, origen, nota };
}

/** Código sugerido para un lugar nuevo: 1 palabra → 4 letras; varias → iniciales + 3 letras de la última. */
export function suggestCode(name: string): string {
  const ws = words(name);
  if (ws.length === 0) return '';
  if (ws.length === 1) return ws[0].slice(0, ws[0].length <= 5 ? 5 : 4);
  const last = ws[ws.length - 1];
  return (
    ws
      .slice(0, -1)
      .map((w) => (/^\d+$/.test(w) ? w : w[0]))
      .join('') + (/^\d+$/.test(last) ? last : last.slice(0, 3))
  );
}

export interface CodeResult {
  codigo: string | null;
  origen: CodeSource | null;
}

/** Catálogo de códigos de lugares: configuración > aprendidos de GEODATA/RUTAS > sugeridos (si se permite). */
export class CodeBook {
  private readonly fixed: Record<string, string>;
  private readonly used = new Map<string, string>();
  readonly sugeridos = new Map<string, { nombre: string; codigo: string }>();

  constructor(
    cfgCodes: Record<string, string>,
    private readonly learned: Record<string, string>,
    private readonly mode: 'sugerir' | 'revision',
    private readonly alias: Record<string, string>,
  ) {
    this.fixed = Object.fromEntries(Object.entries(cfgCodes).map(([k, v]) => [placeKey(k, alias), v.toUpperCase()]));
    for (const [k, v] of [...Object.entries(learned), ...Object.entries(this.fixed)]) this.used.set(v, k);
  }

  codeFor(name: string): CodeResult {
    const key = placeKey(name, this.alias);
    if (!key) return { codigo: null, origen: null };
    const find = <T>(m: Record<string, T> | Map<string, T>) => {
      const entries = m instanceof Map ? [...m.entries()] : Object.entries(m);
      return entries.find(([k]) => k === key)?.[1] ?? entries.find(([k]) => sameKey(k, key))?.[1];
    };
    const fixed = find(this.fixed);
    if (fixed) return { codigo: fixed, origen: 'config' };
    const learned = find(this.learned);
    if (learned) return { codigo: learned, origen: 'aprendido' };
    if (this.mode === 'revision') return { codigo: null, origen: null };
    const prev = find(this.sugeridos);
    if (prev) return { codigo: prev.codigo, origen: 'sugerido' };
    // único: si el código ya es de otro lugar se le agrega un número (TEMI → TEMI2)
    const base = suggestCode(name);
    let code = base;
    for (let k = 2; this.used.has(code) && this.used.get(code) !== key; k++) code = `${base}${k}`;
    this.used.set(code, key);
    this.sugeridos.set(key, { nombre: name, codigo: code });
    return { codigo: code, origen: 'sugerido' };
  }
}

/** Rellena el patrón y valida el resultado. */
export function fillPattern(pattern: string, parts: { ruta: string; origen: string; destino: string; via?: string | null }): string {
  const name = pattern
    .replace('{ruta}', parts.ruta)
    .replace('{origen}', parts.origen)
    .replace('{destino}', parts.destino)
    .replace('{via}', parts.via ? `X${parts.via}` : '');
  if (!/^[A-Z0-9_]+(-[A-Z0-9_]+)+$/.test(name)) throw new Error(`Nombre inválido: ${name}`);
  return name;
}

export const validCode = (c: string) => CODE_RE.test(c);
