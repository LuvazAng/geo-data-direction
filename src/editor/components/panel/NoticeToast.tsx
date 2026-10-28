import type { Notice } from '../../hooks/useNotice';

/** Aviso temporal en la esquina, con su botón si trae uno (p. ej. «Deshacer»). */
export function NoticeToast({ notice, onAction }: { notice: Notice | null; onAction: () => void }) {
  if (!notice) return null;
  return (
    <div className={`notice ${notice.kind}`}>
      {notice.text}
      {notice.action && (
        <button className="link" onClick={onAction}>
          {notice.action.label}
        </button>
      )}
    </div>
  );
}
