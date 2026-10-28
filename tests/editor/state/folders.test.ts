import { describe, expect, it } from 'vitest';
import type { Organization } from '@core';
import { assignDuplaFolders, insideFolder, liftExtraFolders, liftFolder, liftFolderIn, renameFolderIn, swapFolder } from '../../../src/editor/state/folders';
import type { Route } from '../../../src/editor/services/route';

const route = (id: string, folder: string, over: Partial<Route> = {}): Route =>
  ({ id, folder, letter: id, color: '#000', outName: id, reversed: false, visible: true, saved: 'ok', ...over }) as Route;

describe('renombrar carpetas', () => {
  it('swapFolder cambia la carpeta y sus subcarpetas, no las que sólo empiezan igual', () => {
    const swap = swapFolder('1', '2');
    expect(['1', '1/ALT', '1/ALT/x', '10', '', '3'].map(swap)).toEqual(['2', '2/ALT', '2/ALT/x', '10', '', '3']);
  });

  it('renameFolderIn cambia sólo los trazos afectados y limpia su aviso de guardado', () => {
    const rs = [route('a', '1'), route('b', '1/ALT'), route('c', '3')];
    const out = renameFolderIn(rs, '1', 'ida');
    expect(out.map((r) => r.folder)).toEqual(['ida', 'ida/ALT', '3']);
    expect(out.map((r) => r.saved)).toEqual([undefined, undefined, 'ok']);
    expect(out[2]).toBe(rs[2]);
  });
});

describe('quitar una carpeta sin sus trazos', () => {
  it('insideFolder: la carpeta y sus subcarpetas', () => {
    const inside = insideFolder('A/B');
    expect(['A/B', 'A/B/C', 'A/BB', 'A', ''].map(inside)).toEqual([true, true, false, false, false]);
  });

  it('liftFolder sube un nivel los trazos y las subcarpetas', () => {
    const lift = liftFolder('A/B');
    expect(['A/B', 'A/B/C', 'A/B/C/D', 'A', 'X'].map(lift)).toEqual(['A', 'A/C', 'A/C/D', 'A', 'X']);
  });

  it('una carpeta de primer nivel sube a la raíz', () => {
    const lift = liftFolder('X');
    expect(['X', 'X/Y', 'Z'].map(lift)).toEqual(['', 'Y', 'Z']);
  });

  it('liftFolderIn y liftExtraFolders', () => {
    const out = liftFolderIn([route('a', 'A/B'), route('b', 'A/B/C'), route('c', 'Z')], 'A/B');
    expect(out.map((r) => r.folder)).toEqual(['A', 'A/C', 'Z']);
    expect(liftExtraFolders(['A/B', 'A/B/C', 'Z'], 'A/B')).toEqual(['A/C', 'Z']);
  });
});

describe('assignDuplaFolders', () => {
  const org = { folderOf: { a: '1', b: '2' } } as unknown as Organization;

  it('cada trazo va a la carpeta de su dupla y una alterna sigue a su principal', () => {
    const rs = [route('a', ''), route('b', ''), route('alt', 'x', { alt: { mainId: 'b', shortId: 's' } }), route('sin', 'queda')];
    const out = assignDuplaFolders(rs, org);
    expect(out.map((r) => r.folder)).toEqual(['1', '2', '2', 'queda']);
    expect(out[3]).toBe(rs[3]);
    expect(out[0].saved).toBeUndefined();
  });
});
