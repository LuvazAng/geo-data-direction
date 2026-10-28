import type { ReactNode } from 'react';
import { Icon } from './icons';

interface Props {
  title: string;
  /** Cuántos elementos esconde (se muestra junto al título). */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Sección que se pliega: el título y el contador siempre se ven, el contenido sólo al abrirla. */
export function Fold({ title, count, defaultOpen = false, children }: Props) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary>
        <Icon name="chevron-right" size={14} />
        <span className="fold-title">{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
