// Atajos de teclado del editor: qué significa cada tecla. El editor decide qué hacer con el resultado.

export type Shortcut =
  | { type: 'save'; next: boolean }
  | { type: 'undo' }
  | { type: 'invert' }
  | { type: 'remove' }
  | { type: 'edit' }
  | { type: 'cancel' }
  | { type: 'group'; delta: 1 | -1 }
  | { type: 'fit' }
  /** `position`: 1 a 9, el orden de los trazos en la lista. */
  | { type: 'select'; position: number };

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutContext {
  hasSelection: boolean;
  routeCount: number;
}

export function shortcutFor(e: KeyInput, ctx: ShortcutContext): Shortcut | null {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 's') return { type: 'save', next: e.shiftKey };
  if (ctrl && k === 'z') return { type: 'undo' };
  if (ctrl || e.altKey) return null;
  if (k === 'r' && ctx.hasSelection) return { type: 'invert' };
  if (k === 'delete' && ctx.hasSelection) return { type: 'remove' };
  if (k === 'e' && ctx.hasSelection) return { type: 'edit' };
  if (k === 'escape') return { type: 'cancel' };
  if (k === 'n') return { type: 'group', delta: 1 };
  if (k === 'p') return { type: 'group', delta: -1 };
  if (k === 'f') return { type: 'fit' };
  if (/^[1-9]$/.test(k) && Number(k) <= ctx.routeCount) return { type: 'select', position: Number(k) };
  return null;
}
