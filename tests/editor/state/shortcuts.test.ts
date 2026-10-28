import { describe, expect, it } from 'vitest';
import { shortcutFor, type KeyInput } from '../../../src/editor/state/shortcuts';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const ctx = { hasSelection: true, routeCount: 3 };

describe('shortcutFor', () => {
  it('Ctrl/Cmd+S guarda; con Shift guarda y pasa a la siguiente carpeta', () => {
    expect(shortcutFor(key('s', { ctrlKey: true }), ctx)).toEqual({ type: 'save', next: false });
    expect(shortcutFor(key('S', { metaKey: true, shiftKey: true }), ctx)).toEqual({ type: 'save', next: true });
  });

  it('Ctrl/Cmd+Z deshace, haya o no trazo seleccionado', () => {
    expect(shortcutFor(key('z', { ctrlKey: true }), ctx)).toEqual({ type: 'undo' });
    expect(shortcutFor(key('z', { metaKey: true }), { hasSelection: false, routeCount: 0 })).toEqual({ type: 'undo' });
  });

  it('otras combinaciones con Ctrl o Alt no hacen nada', () => {
    for (const k of ['r', 'n', 'f', '1', 'e', 'delete']) {
      expect(shortcutFor(key(k, { ctrlKey: true }), ctx), `Ctrl+${k}`).toBeNull();
      expect(shortcutFor(key(k, { altKey: true }), ctx), `Alt+${k}`).toBeNull();
    }
  });

  it('R, Supr y E actúan sobre el trazo seleccionado (y sin selección no hacen nada)', () => {
    expect(shortcutFor(key('r'), ctx)).toEqual({ type: 'invert' });
    expect(shortcutFor(key('R'), ctx)).toEqual({ type: 'invert' });
    expect(shortcutFor(key('Delete'), ctx)).toEqual({ type: 'remove' });
    expect(shortcutFor(key('e'), ctx)).toEqual({ type: 'edit' });
    const none = { hasSelection: false, routeCount: 3 };
    expect([key('r'), key('Delete'), key('e')].map((k) => shortcutFor(k, none))).toEqual([null, null, null]);
  });

  it('Esc, N, P y F no necesitan selección', () => {
    const none = { hasSelection: false, routeCount: 0 };
    expect(shortcutFor(key('Escape'), none)).toEqual({ type: 'cancel' });
    expect(shortcutFor(key('n'), none)).toEqual({ type: 'group', delta: 1 });
    expect(shortcutFor(key('p'), none)).toEqual({ type: 'group', delta: -1 });
    expect(shortcutFor(key('f'), none)).toEqual({ type: 'fit' });
  });

  it('1-9 eligen el trazo de esa posición, si existe', () => {
    expect(shortcutFor(key('1'), ctx)).toEqual({ type: 'select', position: 1 });
    expect(shortcutFor(key('3'), ctx)).toEqual({ type: 'select', position: 3 });
    expect(shortcutFor(key('4'), ctx)).toBeNull();
    expect(shortcutFor(key('0'), ctx)).toBeNull();
  });

  it('una tecla cualquiera no hace nada', () => {
    expect(shortcutFor(key('x'), ctx)).toBeNull();
    expect(shortcutFor(key('Enter'), ctx)).toBeNull();
  });
});
