import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { path7za } from '7zip-bin';
import { fileIn } from './colonias';

// Descarga de las colonias del INE (Base Geográfica Digital). El INE entrega todo Morelos en un .7z
// (16 MB; trae también manzanas, vialidades, secciones…): de ahí sólo se conservan las capas COLONIA y
// MUNICIPIO. El formato .7z no lo abre ni Node ni el `tar` de Windows, por eso `7zip-bin`.

/** Corte del 15 de diciembre de 2025, shapefile «externos sin NUMEXT», entidad 17 (Morelos). */
export const INE_BGD_URL = 'https://cartografia.ine.mx/mapoteca/BGD_15_diciembre_2025/04%20SHAPEFILE_EXTERNOS%20SIN%20NUMEXT/17%20MORELOS.7z';
export const INE_BGD_PORTAL = 'https://cartografia.ine.mx/sige8/productosCartograficos/bases';

const CAPAS = ['COLONIA', 'MUNICIPIO'];
const MAX_BYTES = 200 * 1024 * 1024;
const MAGIC_7Z = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

/** El 7za de `7zip-bin` listo para ejecutar: en Linux y macOS el paquete se instala sin permiso de ejecución. */
export function rutaDe7za() {
  if (process.platform !== 'win32') {
    try {
      chmodSync(path7za, 0o755);
    } catch {
      /* sin permiso para cambiarlo: si de verdad no es ejecutable, lo dirá el intento de usarlo */
    }
  }
  return path7za;
}

/** ¿Ya están las capas que lee el orquestador? */
export const coloniasInstaladas = (dir: string) => existsSync(dir) && CAPAS.every((c) => ['shp', 'dbf', 'prj'].every((e) => fileIn(dir, c, e)));

export interface InstalarOpciones {
  url?: string;
  fetchImpl?: typeof fetch;
  log?: (mensaje: string) => void;
}

/** Baja el .7z del INE y deja COLONIA.* y MUNICIPIO.* en `dir`. */
export async function instalarColonias(dir: string, { url = INE_BGD_URL, fetchImpl = fetch, log = () => {} }: InstalarOpciones = {}) {
  const trabajo = mkdtempSync(join(tmpdir(), 'ine-bgd-'));
  try {
    log(`Descargando ${url}`);
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      throw new Error(`No se pudo descargar ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`No se pudo descargar ${url}: el servidor respondió ${res.status}`);
    const archivo = Buffer.from(await res.arrayBuffer());
    if (archivo.length > MAX_BYTES)
      throw new Error(`La descarga pesa ${(archivo.length / 1024 / 1024).toFixed(0)} MB y se esperaba menos de ${MAX_BYTES / 1024 / 1024} MB`);
    if (!archivo.subarray(0, MAGIC_7Z.length).equals(MAGIC_7Z)) throw new Error(`Lo descargado de ${url} no es un archivo .7z`);
    const zip = join(trabajo, 'bgd.7z');
    writeFileSync(zip, archivo);
    log(`Extrayendo ${CAPAS.join(' y ')} (${(archivo.length / 1024 / 1024).toFixed(1)} MB descargados)`);
    const salida = join(trabajo, 'capas');
    try {
      await promisify(execFile)(rutaDe7za(), ['e', zip, `-o${salida}`, '-y', '-bd', ...CAPAS.map((c) => `-ir!${c}.*`)]);
    } catch (e) {
      throw new Error(`No se pudo extraer el archivo del INE: ${(e as { stderr?: string; message: string }).stderr?.trim() || (e as Error).message}`);
    }
    if (!coloniasInstaladas(salida)) throw new Error(`El archivo del INE no trae las capas ${CAPAS.join(' y ')} (.shp, .dbf y .prj); ¿cambió su contenido?`);
    mkdirSync(dir, { recursive: true });
    for (const nombre of readdirSync(salida)) copyFileSync(join(salida, nombre), join(dir, nombre));
    writeFileSync(
      join(dir, 'FUENTE.txt'),
      [
        'Colonias de Morelos - INE, Base Geográfica Digital (BGD)',
        '',
        'Corte:    15 de diciembre de 2025, shapefile «externos sin NUMEXT», entidad 17 MORELOS',
        `Portal:   ${INE_BGD_PORTAL}`,
        `Archivo:  ${url}`,
        `Descarga: ${new Date().toISOString().slice(0, 10)} (npm run colonias)`,
        '',
        'COLONIA   polígonos de colonias, barrios, fraccionamientos, pueblos… (DBF en ISO-8859-1, sin .cpg)',
        'MUNICIPIO municipios, sólo para el nombre (DBF en UTF-8)',
        'Proyección: WGS 1984 UTM zona 14N (metros).',
        '',
      ].join('\n'),
    );
    log(`Colonias instaladas en ${dir}`);
  } finally {
    rmSync(trabajo, { recursive: true, force: true });
  }
}
