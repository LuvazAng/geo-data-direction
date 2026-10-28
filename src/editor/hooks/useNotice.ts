import { useCallback, useRef, useState } from 'react';

export interface Notice {
  text: string;
  kind: 'ok' | 'error';
  /** Botón en el aviso (p. ej. deshacer una eliminación). */
  action?: { label: string; run: () => void };
}

export type Notify = (text: string, kind?: Notice['kind'], action?: Notice['action']) => void;

/** Aviso temporal en la esquina: 5 s, o 10 s si trae un botón (p. ej. «Deshacer»). */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number>(undefined);

  const notify = useCallback((text: string, kind: Notice['kind'] = 'ok', action?: Notice['action']) => {
    setNotice({ text, kind, action });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), action ? 10000 : 5000);
  }, []);

  const runNoticeAction = () => {
    notice?.action?.run();
    setNotice(null);
  };

  /** Un «deshacer» pendiente ya no aplica (p. ej. al cargar otros trazos). */
  const dropUndo = useCallback(() => setNotice((n) => (n?.action ? null : n)), []);

  return { notice, notify, runNoticeAction, dropUndo };
}
