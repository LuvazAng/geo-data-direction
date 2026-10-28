import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

interface Props {
  title: string;
  /** Una frase que dice para qué sirve el cajón. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Cajón que cubre la columna donde se abre (el contenedor debe tener `position: relative`). Esc o «Volver» lo cierran
 * y el foco regresa a donde estaba al abrirlo.
 */
export function Drawer({ title, description, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <section
      ref={ref}
      className="drawer"
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // los atajos globales también escuchan Esc (cancelar edición): aquí sólo se cierra el cajón
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="drawer-head">
        <button className="quiet" onClick={onClose}>
          <Icon name="chevron-left" /> Volver
        </button>
        <h2>{title}</h2>
      </header>
      {description && <p className="drawer-description">{description}</p>}
      <div className="drawer-body">{children}</div>
    </section>
  );
}
