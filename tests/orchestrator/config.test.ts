import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/orchestrator/config';
import { dataDirs, loadEnv, PROJECT_DIR } from '../../src/orchestrator/paths';
import { tmp } from '../helpers';

const lote = (work: string, extra: object = {}) => {
  const file = join(work, 'lote.json');
  writeFileSync(file, JSON.stringify({ lote: 'PRUEBA', zona: 'SUR', fuente: { url: 'https://sites.google.com/view/prueba/sur' }, ...extra }));
  return file;
};

describe('carpetas de datos', () => {
  it('sin nada definido, todo queda dentro de <repo>/data', () => {
    const d = dataDirs({});
    expect(d).toEqual({
      trabajo: resolve(PROJECT_DIR, 'data/RUTAS_ORQUESTADOR'),
      existentes: resolve(PROJECT_DIR, 'data/RUTAS'),
      inegi: resolve(PROJECT_DIR, 'data/inegi/conjunto_de_datos'),
      colonias: resolve(PROJECT_DIR, 'data/INE_BGD_2025/17_morelos'),
    });
  });

  it('GEODATA_DIR cambia la raíz de las cuatro', () => {
    const root = resolve('/mis/datos');
    const d = dataDirs({ GEODATA_DIR: root });
    expect(d.trabajo).toBe(join(root, 'RUTAS_ORQUESTADOR'));
    expect(d.existentes).toBe(join(root, 'RUTAS'));
    expect(d.inegi).toBe(join(root, 'inegi', 'conjunto_de_datos'));
    expect(d.colonias).toBe(join(root, 'INE_BGD_2025', '17_morelos'));
  });

  it('manda la variable de la carpeta, luego el archivo del lote (relativo a él) y al final la raíz', () => {
    const root = resolve('/mis/datos');
    const base = resolve('/config/lotes');
    const d = dataDirs({ GEODATA_DIR: root, INEGI_DIR: '/otro/inegi' }, { inegi: '../ignorado', colonias: '../colonias' }, base);
    expect(d.inegi).toBe(resolve('/otro/inegi'));
    expect(d.colonias).toBe(resolve('/config/colonias'));
    expect(d.trabajo).toBe(join(root, 'RUTAS_ORQUESTADOR'));
  });
});

describe('.env', () => {
  it('completa el entorno sin pisar lo que ya estaba definido', () => {
    const work = tmp();
    const file = join(work, '.env');
    writeFileSync(file, '# comentario\nGEODATA_DIR=/del/archivo\nOLLAMA_URL="http://127.0.0.1:1234"\nCENTRO_PORT=5300\n');
    const env: NodeJS.ProcessEnv = { CENTRO_PORT: '6000' };
    loadEnv(env, file);
    expect(env).toEqual({ GEODATA_DIR: '/del/archivo', OLLAMA_URL: 'http://127.0.0.1:1234', CENTRO_PORT: '6000' });
  });

  it('un archivo que no existe no es un error', () => {
    const env: NodeJS.ProcessEnv = {};
    loadEnv(env, join(tmp(), 'no-hay.env'));
    expect(env).toEqual({});
  });
});

describe('loadConfig y las carpetas de datos', () => {
  it('un lote sin `dirs` usa las carpetas por omisión de GEODATA_DIR', () => {
    const root = resolve('/mis/datos');
    const cfg = loadConfig(lote(tmp()), { GEODATA_DIR: root });
    expect(cfg.dirs).toEqual(dataDirs({ GEODATA_DIR: root }));
  });

  it('`dirs` del archivo se resuelve contra la carpeta del archivo y la variable manda sobre él', () => {
    const work = tmp();
    mkdirSync(join(work, 'x'));
    const file = lote(work, { dirs: { trabajo: 'salida', inegi: 'x/inegi' } });
    const a = loadConfig(file, {});
    expect(a.dirs.trabajo).toBe(join(work, 'salida'));
    expect(a.dirs.inegi).toBe(join(work, 'x', 'inegi'));
    expect(loadConfig(file, { RUTAS_TRABAJO_DIR: resolve('/fuera') }).dirs.trabajo).toBe(resolve('/fuera'));
  });
});
