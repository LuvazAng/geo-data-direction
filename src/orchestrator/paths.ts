import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** Raíz del repositorio (este archivo está en src/orchestrator). */
export const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Pone en `env` lo que diga el archivo `.env` de la raíz (si existe). Lo que ya está definido en el
 * entorno manda sobre el archivo.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env, file = join(PROJECT_DIR, '.env')) {
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) if (env[k] === undefined) env[k] = v;
}

/** Carpetas de datos del orquestador: trabajo (salida), casos etiquetados, INEGI y colonias del INE. */
export interface DataDirs {
  trabajo: string;
  existentes: string;
  inegi: string;
  colonias: string;
}

/**
 * Dónde está cada carpeta de datos. Para cada una manda, en orden: su variable de entorno
 * (`RUTAS_TRABAJO_DIR`, `RUTAS_EXISTENTES_DIR`, `INEGI_DIR`, `COLONIAS_DIR`), lo que diga el archivo del
 * lote (`fromFile`, relativo a `base`) y la carpeta por omisión dentro de `GEODATA_DIR` (`<repo>/data`
 * si no se define). Ver data/README.md.
 */
export function dataDirs(env: NodeJS.ProcessEnv = process.env, fromFile: Partial<DataDirs> = {}, base = PROJECT_DIR): DataDirs {
  const root = resolve(env.GEODATA_DIR || join(PROJECT_DIR, 'data'));
  const pick = (name: string, key: keyof DataDirs, fallback: string) => resolve(env[name] || (fromFile[key] ? resolve(base, fromFile[key]) : fallback));
  return {
    trabajo: pick('RUTAS_TRABAJO_DIR', 'trabajo', join(root, 'RUTAS_ORQUESTADOR')),
    existentes: pick('RUTAS_EXISTENTES_DIR', 'existentes', join(root, 'RUTAS')),
    inegi: pick('INEGI_DIR', 'inegi', join(root, 'inegi', 'conjunto_de_datos')),
    colonias: pick('COLONIAS_DIR', 'colonias', join(root, 'INE_BGD_2025', '17_morelos')),
  };
}
