import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeOutputs, type OutputEntry } from '../../../src/orchestrator/io/output';
import { safeName, sha256, Workspace } from '../../../src/orchestrator/io/store';
import { tmp } from '../../helpers';

const entry = (rel: string, kml = `<kml>${rel}</kml>`): OutputEntry => ({
  rel,
  kml,
  tipo: 'resultado',
  traza: 't',
  mapa: 'm',
  fuente: 'https://x',
  original: 'originales/m.kml',
});

describe('escritura idempotente (caso 14)', () => {
  it('reprocesar lo mismo no duplica ni reescribe', () => {
    const ws = new Workspace(tmp(), 'L');
    const e = [entry('SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml')];
    expect(writeOutputs(ws, e).escritos).toHaveLength(1);
    const again = writeOutputs(ws, e);
    expect(again).toMatchObject({ escritos: [], actualizados: [], sinCambios: ['SUR/RUTA-1-SUR/1/R1S-JOJU-IXT.kml'], obsoletos: [] });
  });

  it('actualiza lo que generó y nadie tocó; respeta lo modificado a mano', () => {
    const ws = new Workspace(tmp(), 'L');
    const rel = 'SUR/R/1/A.kml';
    writeOutputs(ws, [entry(rel, '<kml>v1</kml>')]);
    expect(writeOutputs(ws, [entry(rel, '<kml>v2</kml>')]).actualizados).toEqual([rel]);
    writeFileSync(ws.path('resultados', 'SUR', 'R', '1', 'A.kml'), '<kml>editado a mano</kml>');
    const r = writeOutputs(ws, [entry(rel, '<kml>v3</kml>')]);
    expect(r.conflictos[0]).toMatchObject({ rel });
    expect(ws.read('resultados', 'SUR', 'R', '1', 'A.kml').toString()).toBe('<kml>editado a mano</kml>');
  });

  it('lo que ya no se genera se mueve a _obsoletos (no se borra)', () => {
    const ws = new Workspace(tmp(), 'L');
    writeOutputs(ws, [entry('SUR/R/1/VIEJO.kml'), entry('SUR/R/1/SIGUE.kml')]);
    const r = writeOutputs(ws, [entry('SUR/R/1/SIGUE.kml')], new Date('2026-01-01T00:00:00Z'));
    expect(r.obsoletos).toEqual(['SUR/R/1/VIEJO.kml']);
    expect(ws.exists('resultados', '_obsoletos', '2026-01-01T00-00-00-000Z', 'SUR', 'R', '1', 'VIEJO.kml')).toBe(true);
  });

  it('dos trazos con la misma ruta de archivo: el segundo es conflicto (caso 12)', () => {
    const ws = new Workspace(tmp(), 'L');
    const r = writeOutputs(ws, [entry('SUR/R/1/A.kml', '<kml>1</kml>'), entry('SUR/R/1/A.kml', '<kml>2</kml>')]);
    expect(r.escritos).toHaveLength(1);
    expect(r.conflictos[0].motivo).toMatch(/misma ruta/);
  });

  it('preserva salidas aprobadas manualmente y no las obsoletiza', () => {
    const ws = new Workspace(tmp(), 'L');
    const rel = 'SUR/RUTA-1-SUR/1/R1-A-B.kml';
    const content = '<kml>aprobado por una persona</kml>';
    ws.write(['resultados', ...rel.split('/')], content);
    ws.writeJson(['resultados', 'manifiesto.json'], {
      version: 1,
      archivos: {
        [rel]: {
          ...entry(rel),
          sha256: sha256(content),
          generadoEn: '',
          resolucionManual: { tipo: 'propia', nombre: 'R1-A-B', nota: '', resueltoEn: '' },
        },
      },
    });

    const overwritten = writeOutputs(ws, [entry(rel, '<kml>otra decisión automática</kml>')]);
    expect(overwritten.conflictos[0].motivo).toMatch(/aprobado manualmente/);
    expect(ws.read('resultados', ...rel.split('/')).toString()).toBe(content);

    const absent = writeOutputs(ws, []);
    expect(absent.obsoletos).toEqual([]);
    expect(ws.exists('resultados', ...rel.split('/'))).toBe(true);
  });
});

describe('ejecución por ruta (scope) y candado del lote', () => {
  it('con scope, los archivos de otros mapas no se tocan ni se consideran obsoletos', () => {
    const ws = new Workspace(tmp(), 'L');
    const a = { ...entry('SUR/R1/1/A.kml'), mapa: 'm1' };
    const b = { ...entry('SUR/R2/1/B.kml'), mapa: 'm2' };
    writeOutputs(ws, [a, b]);
    // sólo se procesa la ruta del mapa m1, y ya no genera A
    const r = writeOutputs(ws, [], new Date(), new Set(['m1']));
    expect(r.obsoletos).toEqual(['SUR/R1/1/A.kml']);
    expect(ws.exists('resultados', 'SUR', 'R2', '1', 'B.kml')).toBe(true);
  });

  it('dos procesos no pueden escribir el mismo lote a la vez; un candado huérfano se recupera', () => {
    const ws = new Workspace(tmp(), 'L');
    const release = ws.lock('prueba');
    expect(() => ws.lock('otro')).toThrow(/en uso/);
    release();
    expect(() => ws.lock('otro')()).not.toThrow();
    // candado de un proceso que ya no existe
    writeFileSync(ws.path('.lock'), JSON.stringify({ pid: 999999, owner: 'muerto', desde: '' }));
    expect(() => ws.lock('nuevo')()).not.toThrow();
  });
});

describe('escritura restringida al lote', () => {
  it('rechaza rutas que salen de la carpeta del lote', () => {
    const ws = new Workspace(tmp(), 'L');
    expect(() => ws.path('..', 'fuera.kml')).toThrow(/fuera del lote/);
    expect(() => ws.write(['resultados', '..', '..', 'x.kml'], 'x')).toThrow(/fuera del lote/);
  });
  it('nombres seguros para Windows', () => {
    expect(safeName('a/b\\c:d*e?"f<g>h|')).toBe('a-b-c-d-e-f-g-h-');
    expect(safeName('..\\..\\x')).not.toMatch(/[\\/]/);
  });
});
