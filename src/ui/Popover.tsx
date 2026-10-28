import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

interface Props {
  label: ReactNode;
  icon?: IconName;
  title?: string;
  /** De qué lado del botón se alinea el panel. */
  align?: 'left' | 'right';
  disabled?: boolean;
  /** Clases del botón (por omisión, discreto). */
  className?: string;
  /** El panel es una lista de acciones (`button.pop-item`), no un formulario. */
  menu?: boolean;
  /** El contenido, o una función que recibe cómo cerrarlo (para menús que se cierran al elegir). */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** Botón que abre un panel flotante debajo de él. Se cierra con un clic fuera o con Esc. */
export function Popover({ label, icon, title, align = 'right', disabled, className = 'quiet', menu, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc cierra sólo el panel: quien escuche Esc más arriba (cerrar una pantalla) no debe enterarse
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div className="pop" ref={ref}>
      <button
        className={`${className}${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={label ? undefined : title}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {open && (
        <div className={`pop-panel ${align}${menu ? ' menu' : ''}`} role="group">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
