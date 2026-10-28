import { describe, expect, it } from 'vitest';
import type { ParsedKml } from '@core';
import { createdSubfolders, exportTitle, needsZip, zipEntries } from '../../../src/editor/state/export';
import { DONE_KEY, loadDone, saveDone } from '../../../src/editor/state/storage';
import type { Route } from '../../../src/editor/services/route';

const route = (over: Omit<Partial<Route>, 'source'> & { source?: Partial<Route['source']> } = {}): Route =>
  ({
    id: '1',
    outName: 'Ida',
    folder: '',
    parsed: { count: 1 } as ParsedKml,
    ...over,
    source: { file: new File([''], 'ruta-1.kml'), path: 'ruta-1.kml', ...over.source },
  }) as Route;

const fakeDir = {} as FileSystemDirectoryHandle;
const fakeHandle = {} as FileSystemFileHandle;

describe('carpetas ya revisadas (storage)', () => {
  it('guarda y recupera', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveDone({ 'SUR/RUTA-1/1': true }, storage);
    expect(data.get(DONE_KEY)).toBe('{"SUR/RUTA-1/1":true}');
    expect(loadDone(storage)).toEqual({ 'SUR/RUTA-1/1': true });
  });

  it('sin nada guardado o con datos dañados devuelve vacío', () => {
    expect(loadDone({ getItem: () => null })).toEqual({});
    expect(loadDone({ getItem: () => '{no es json' })).toEqual({});
    expect(
      loadDone({
        getItem: () => {
          throw new Error('bloqueado');
        },
      }),
    ).toEqual({});
  });

  it('si no se puede escribir (almacenamiento lleno o bloqueado) no falla', () => {
    expect(() =>
      saveDone(
        { a: true },
        {
          setItem: () => {
            throw new Error('lleno');
          },
        },
      ),
    ).not.toThrow();
  });
});

describe('needsZip', () => {
  it('con carpeta abierta (dir o baseDir) se escribe en disco', () => {
    expect(needsZip([route({ source: { dir: fakeDir } })])).toBe(false);
    expect(needsZip([route({ source: { baseDir: fakeDir } })])).toBe(false);
  });

  it('un archivo suelto sin carpeta se descarga en un ZIP', () => {
    expect(needsZip([route()])).toBe(true);
  });

  it('un archivo suelto con acceso (handle) se sobrescribe, salvo que traiga varios trazos o una carpeta nueva', () => {
    expect(needsZip([route({ source: { handle: fakeHandle } })])).toBe(false);
    expect(needsZip([route({ source: { handle: fakeHandle }, parsed: { count: 2 } as ParsedKml })])).toBe(true);
    expect(needsZip([route({ source: { handle: fakeHandle }, folder: '1' })])).toBe(true);
  });

  it('basta que un trazo pueda escribirse en disco para no usar ZIP', () => {
    expect(needsZip([route(), route({ source: { dir: fakeDir } })])).toBe(false);
  });
});

describe('zipEntries, exportTitle y createdSubfolders', () => {
  it('zipEntries arma la ruta con la carpeta y limpia el nombre', () => {
    const out = zipEntries([route({ outName: 'A/B: ruta', folder: '1/ALT' }), route({ outName: 'Vuelta' })], (r) => `<${r.outName}>`);
    expect(out).toEqual([
      { path: '1/ALT/A-B- ruta.kml', content: '<A/B: ruta>' },
      { path: 'Vuelta.kml', content: '<Vuelta>' },
    ]);
  });

  it('exportTitle: la última carpeta abierta o, si no, el primer archivo', () => {
    expect(exportTitle({ folder: 'SUR/RUTA-1/1', files: [] }, [route()])).toBe('1');
    expect(exportTitle(undefined, [route()])).toBe('ruta-1');
    expect(exportTitle(undefined, [])).toBe('rutas');
  });

  it('createdSubfolders: las subcarpetas de los archivos guardados, sin repetir', () => {
    expect(createdSubfolders(['a.kml', '1/b.kml', '1/c.kml', '2/ALT/d.kml'])).toEqual(['1', '2/ALT']);
    expect(createdSubfolders(['a.kml'])).toEqual([]);
  });
});
