import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type Coord, parseKmlAll, lengthKm } from '@core';
import { tokens } from './places';

// Rutas ya clasificadas a mano (GEODATA/RUTAS/<ZONA>/<RUTA>/<n>/<CÓDIGO>-<ORIG>-<DEST>.kml).
// Sirven para: (1) conocer los códigos de ruta de otras zonas (letra de zona), (2) aprender los
// códigos de localidad por mayoría y (3) medir las decisiones automáticas contra casos etiquetados.

export interface ParsedName {
  ruta: string;
  origen: string;
  destino: string;
  via: string | null;
}

export interface LabeledFile {
  id: string;
  rel: string;
  zona: string;
  carpeta: string;
  dupla: string;
  nombre: string;
  parsed: ParsedName | null;
  coords: Coord[];
  lengthM: number;
}

/**
 * "R1S-JOJU-IXT" → ruta R1S, origen JOJU, destino IXT. La "vía" se escribe pegada al destino con X
 * ("R4-BA-CHXPU") o como cuarta parte ("R2-5FRC-BU-XEZ"); sólo se separa si lo que queda antes de
 * la X es un código que existe por sí solo (así "IXT" no se parte).
 */
export function parseRouteName(name: string, standalone: Set<string> = new Set()): ParsedName | null {
  const parts = name
    .replace(/\.(kml|kmz)$/i, '')
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const [ruta, origen] = parts;
  let destino = parts[2];
  let via: string | null = parts[3] && /^X/i.test(parts[3]) ? parts[3].slice(1) : null;
  if (!via) {
    for (let i = destino.length - 2; i > 0; i--) {
      if (destino[i] === 'X' && standalone.has(destino.slice(0, i))) {
        via = destino.slice(i + 1);
        destino = destino.slice(0, i);
        break;
      }
    }
  }
  return { ruta, origen, destino, via };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.kml$/i.test(name)) out.push(p);
  }
  return out;
}

export function loadLabeled(root: string): { files: LabeledFile[]; errores: string[] } {
  const errores: string[] = [];
  let paths: string[] = [];
  try {
    paths = walk(root);
  } catch (e) {
    return { files: [], errores: [`No se pudo leer ${root}: ${(e as Error).message}`] };
  }
  const raw = paths.map((p) => {
    const rel = relative(root, p).split(sep).join('/');
    const segs = rel.split('/');
    return { p, rel, zona: segs[0], carpeta: segs[1] ?? '', dupla: segs.length > 3 ? segs[2] : '', nombre: segs[segs.length - 1].replace(/\.kml$/i, '') };
  });
  // códigos que aparecen como origen: permiten separar la vía pegada al destino
  const standalone = new Set(raw.map((r) => r.nombre.split('-')[1]?.trim()).filter(Boolean) as string[]);
  const files: LabeledFile[] = [];
  for (const r of raw) {
    try {
      const t = parseKmlAll(readFileSync(r.p, 'utf8'))[0];
      files.push({
        id: `etiquetado:${r.rel}`,
        rel: r.rel,
        zona: r.zona,
        carpeta: r.carpeta,
        dupla: r.dupla,
        nombre: r.nombre,
        parsed: parseRouteName(r.nombre, standalone),
        coords: t.coords,
        lengthM: lengthKm(t.coords) * 1000,
      });
    } catch (e) {
      errores.push(`${r.rel}: ${(e as Error).message}`);
    }
  }
  return { files, errores };
}

/** Códigos de ruta por zona ("CENTRO" → R1, R2, CTM, INT_ESC…). */
export function routeCodesByZone(files: LabeledFile[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) if (f.parsed) (out.get(f.zona) ?? out.set(f.zona, new Set()).get(f.zona)!).add(f.parsed.ruta);
  return out;
}

/** Números de ruta por zona, tomados de las carpetas (RUTA-4, RUTA-4-SUR…) y de los códigos (R4, R4S…). */
export function routeNumbersByZone(files: LabeledFile[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    const set = out.get(f.zona) ?? out.set(f.zona, new Set()).get(f.zona)!;
    const fromDir = /^RUTA-(\d+)/i.exec(f.carpeta)?.[1];
    const fromCode = f.parsed && /^R(\d+)/.exec(f.parsed.ruta)?.[1];
    if (fromDir) set.add(String(Number(fromDir)));
    if (fromCode) set.add(String(Number(fromCode)));
  }
  return out;
}

/** Clave de catálogo para un nombre de lugar: palabras significativas ("PUENTE DE IXTLA" → "PUENTE IXTLA"). */
export const placeKey = (name: string, alias: Record<string, string> = {}) => tokens(name, alias).join(' ');

export interface Vote {
  codigo: string;
  votos: number;
  archivos: string[];
}

/** Catálogo aprendido: por lugar, el código más usado en los archivos etiquetados (y los que compiten). */
export class LearnedCodes {
  private votes = new Map<string, Map<string, Vote>>();

  add(place: string, code: string, file: string, alias: Record<string, string>) {
    const key = placeKey(place, alias);
    if (!key || !code) return;
    const byCode = this.votes.get(key) ?? this.votes.set(key, new Map()).get(key)!;
    const v = byCode.get(code) ?? byCode.set(code, { codigo: code, votos: 0, archivos: [] }).get(code)!;
    v.votos++;
    if (!v.archivos.includes(file)) v.archivos.push(file);
  }

  /** Código ganador por lugar; en empate, el que aparece en más archivos y luego el alfabético. */
  winners(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, byCode] of this.votes) {
      const best = [...byCode.values()].sort((a, b) => b.votos - a.votos || b.archivos.length - a.archivos.length || a.codigo.localeCompare(b.codigo))[0];
      out[key] = best.codigo;
    }
    return out;
  }

  /** Lugares con más de un código en los archivos existentes (p. ej. Puente de Ixtla: IXT, ITXT, ITX). */
  conflicts(): { lugar: string; codigos: Vote[] }[] {
    return [...this.votes]
      .filter(([, byCode]) => byCode.size > 1)
      .map(([lugar, byCode]) => ({ lugar, codigos: [...byCode.values()].sort((a, b) => b.votos - a.votos) }));
  }

  toJSON() {
    return { codigos: this.winners(), conflictos: this.conflicts() };
  }
}
