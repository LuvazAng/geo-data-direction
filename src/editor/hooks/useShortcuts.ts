import { useEffect } from 'react';
import type { Route } from '../services/route';
import { shortcutFor } from '../state/shortcuts';

interface Ctx {
  /** Con el centro de control abierto, el editor (que queda debajo) no recibe atajos. */
  disabled: boolean;
  routes: Route[];
  selectedId: string | null;
  /** Hay un aviso con «Deshacer» pendiente. */
  hasNoticeAction: boolean;
  runNoticeAction: () => void;
  /** Hay una revisión de mapa en curso: Ctrl+S la guarda en vez de guardar los archivos. */
  reviewing: boolean;
  groupIndex: number;
  setEditId: (update: (current: string | null) => string | null) => void;
  actions: {
    undo: (id: string) => void;
    invert: (id: string) => void;
    removeRoute: (id: string) => void;
    cancelEditAndSnap: () => void;
    goToGroup: (index: number) => Promise<void>;
    fitTo: (ids: string[]) => void;
    select: (id: string | null) => void;
    saveReview: () => Promise<void>;
    saveAll: () => Promise<boolean>;
    saveAllAndNext: () => Promise<void>;
  };
}

/** Atajos de teclado del editor (ver state/shortcuts.ts); se ignoran mientras se escribe en un campo. */
export function useShortcuts({ disabled, routes, selectedId, hasNoticeAction, runNoticeAction, reviewing, groupIndex, setEditId, actions }: Ctx) {
  // sin lista de dependencias: se vuelve a suscribir en cada render para ver siempre el estado vigente
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement;
      const typing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type));
      if (typing) return;
      const action = shortcutFor(e, { hasSelection: !!selectedId, routeCount: routes.length });
      if (!action) return;
      switch (action.type) {
        case 'save':
          e.preventDefault();
          void (reviewing ? actions.saveReview() : action.next ? actions.saveAllAndNext() : actions.saveAll());
          return;
        case 'undo':
          // sin trazo seleccionado (p. ej. justo después de eliminarlo) deshace la eliminación
          if (selectedId) actions.undo(selectedId);
          else if (hasNoticeAction) runNoticeAction();
          else return;
          e.preventDefault();
          return;
        case 'invert':
          actions.invert(selectedId!);
          return;
        case 'remove':
          actions.removeRoute(selectedId!);
          return;
        case 'edit':
          setEditId((cur) => (cur === selectedId ? null : selectedId));
          return;
        case 'cancel':
          actions.cancelEditAndSnap();
          return;
        case 'group':
          void actions.goToGroup(groupIndex + action.delta);
          return;
        case 'fit':
          actions.fitTo(routes.map((r) => r.id));
          return;
        case 'select':
          actions.select(routes[action.position - 1].id);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
