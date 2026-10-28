import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coloniasInstaladas, instalarColonias, rutaDe7za } from '../../../src/orchestrator/io/ine';
import { tmp } from '../../helpers';

/** Un .7z como el del INE: una carpeta «17 MORELOS» con varias capas, de las que sólo interesan dos. */
function archivoIne(capas = ['COLONIA', 'MUNICIPIO', 'MANZANA']) {
  const work = tmp('ine-');
  const dentro = join(work, '17 MORELOS');
  mkdirSync(dentro);
  for (const capa of capas) for (const ext of ['shp', 'dbf', 'prj', 'shx']) writeFileSync(join(dentro, `${capa}.${ext}`), `${capa}.${ext}`);
  const zip = join(work, '17 MORELOS.7z');
  execFileSync(rutaDe7za(), ['a', zip, dentro, '-bd'], { stdio: 'pipe' });
  return readFileSync(zip);
}

const sirve =
  (cuerpo: Buffer | string, status = 200): typeof fetch =>
  async () =>
    new Response(typeof cuerpo === 'string' ? cuerpo : new Uint8Array(cuerpo), { status });

describe('colonias del INE: descarga e instalación', () => {
  it('descarga el .7z y deja sólo COLONIA y MUNICIPIO, con su FUENTE.txt', async () => {
    const dir = join(tmp('colonias-'), 'INE_BGD_2025', '17_morelos');
    const avisos: string[] = [];
    await instalarColonias(dir, { url: 'https://ine.example/17.7z', fetchImpl: sirve(archivoIne()), log: (m) => avisos.push(m) });
    expect(readdirSync(dir).sort()).toEqual([
      'COLONIA.dbf',
      'COLONIA.prj',
      'COLONIA.shp',
      'COLONIA.shx',
      'FUENTE.txt',
      'MUNICIPIO.dbf',
      'MUNICIPIO.prj',
      'MUNICIPIO.shp',
      'MUNICIPIO.shx',
    ]);
    expect(readFileSync(join(dir, 'COLONIA.shp'), 'utf8')).toBe('COLONIA.shp');
    expect(readFileSync(join(dir, 'FUENTE.txt'), 'utf8')).toContain('https://ine.example/17.7z');
    expect(coloniasInstaladas(dir)).toBe(true);
    expect(avisos[0]).toContain('https://ine.example/17.7z');
  });

  it('no deja archivos temporales', async () => {
    const antes = readdirSync(tmpdir()).filter((n) => n.startsWith('ine-bgd-')).length;
    await instalarColonias(join(tmp('colonias-'), 'c'), { fetchImpl: sirve(archivoIne()) });
    await expect(instalarColonias(join(tmp('colonias-'), 'c'), { fetchImpl: sirve('nada') })).rejects.toThrow();
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('ine-bgd-')).length).toBe(antes);
  });

  it('si el servidor responde con error, lo dice con la dirección', async () => {
    const dir = join(tmp('colonias-'), 'c');
    await expect(instalarColonias(dir, { url: 'https://ine.example/x.7z', fetchImpl: sirve('no', 404) })).rejects.toThrow(/https:\/\/ine\.example\/x\.7z.*404/);
    expect(existsSync(dir)).toBe(false);
  });

  it('si no hay red, lo dice', async () => {
    const sinRed: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(instalarColonias(join(tmp('colonias-'), 'c'), { fetchImpl: sinRed })).rejects.toThrow(/No se pudo descargar.*fetch failed/);
  });

  it('rechaza lo que no es un .7z (p. ej. una página de error)', async () => {
    await expect(instalarColonias(join(tmp('colonias-'), 'c'), { fetchImpl: sirve('<html>Acceso denegado</html>') })).rejects.toThrow(/no es un archivo \.7z/);
  });

  it('avisa si el archivo no trae las capas esperadas', async () => {
    const dir = join(tmp('colonias-'), 'c');
    await expect(instalarColonias(dir, { fetchImpl: sirve(archivoIne(['MANZANA'])) })).rejects.toThrow(/no trae las capas COLONIA y MUNICIPIO/);
    expect(existsSync(dir)).toBe(false);
  });

  it('coloniasInstaladas distingue la carpeta vacía y la que no existe', () => {
    const dir = tmp('colonias-');
    expect(coloniasInstaladas(dir)).toBe(false);
    expect(coloniasInstaladas(join(dir, 'no-existe'))).toBe(false);
  });
});
