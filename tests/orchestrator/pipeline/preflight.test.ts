import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MissingDataError } from '../../../src/orchestrator/errors';
import { HttpClient } from '../../../src/orchestrator/io/http';
import { run } from '../../../src/orchestrator/pipeline/pipeline';
import { checkData } from '../../../src/orchestrator/pipeline/run/preflight';
import { fakeFetch, testConfig, tmp } from '../../helpers';

const withInegi = (work: string, dir: string) =>
  testConfig(work, { dirs: { trabajo: work, existentes: join(work, 'RUTAS'), inegi: dir, colonias: join(work, 'colonias') } });

describe('verificación de datos antes de correr', () => {
  it('dice qué capas del INEGI faltan y cómo conseguirlas', () => {
    const work = tmp();
    const dir = join(work, 'inegi');
    mkdirSync(dir);
    writeFileSync(join(dir, '17l.shp'), '');
    let error: unknown;
    try {
      checkData(withInegi(work, dir));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MissingDataError);
    const msg = (error as Error).message;
    expect(msg).toContain('17lpr.shp, 17mun.shp');
    expect(msg).not.toContain('17l.shp,');
    expect(msg).toContain(dir);
    expect(msg).toMatch(/INEGI_DIR|GEODATA_DIR/);
    expect(msg).toContain('data/README.md');
  });

  it('con las tres capas no se queja', () => {
    const work = tmp();
    const dir = join(work, 'inegi');
    mkdirSync(dir);
    for (const capa of ['17l', '17lpr', '17mun']) writeFileSync(join(dir, `${capa}.shp`), '');
    expect(() => checkData(withInegi(work, dir))).not.toThrow();
  });

  it('el orquestador se detiene al empezar, sin tocar la red', async () => {
    const work = tmp();
    const cfg = withInegi(work, join(work, 'no-hay-inegi'));
    const site = fakeFetch({});
    await expect(run(cfg, { http: new HttpClient(cfg.fuente, site.impl, async () => {}) })).rejects.toBeInstanceOf(MissingDataError);
    expect(site.calls).toEqual([]);
  });
});
