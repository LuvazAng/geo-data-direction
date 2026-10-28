import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Si una herramienta se puede usar ahora, conviene usarla, o está apagada (con el motivo). */
export type ToolStatus = { status: 'ready' } | { status: 'recommended'; why: string } | { status: 'off'; reason: string };

interface RowProps {
  icon: IconName;
  label: string;
  description: string;
  shortcut?: string;
  state?: ToolStatus;
  /** Qué hace al pulsarla. Las filas que sólo tienen `control` se manejan desde él. */
  onRun?: () => void;
  control?: ReactNode;
}

/** Una herramienta en un cajón: icono, nombre, qué hace, su estado y, si la tiene, su control. */
export function ToolRow({ icon, label, description, shortcut, state = { status: 'ready' }, onRun, control }: RowProps) {
  const off = state.status === 'off';
  const body = (
    <>
      <span className="tool-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="tool-text">
        <span className="tool-label">
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
          {state.status === 'recommended' && <span className="tool-badge">Recomendado ahora</span>}
        </span>
        <span className="tool-desc">{description}</span>
        {state.status === 'recommended' && <span className="tool-why">{state.why}</span>}
        {off && <span className="tool-reason">{state.reason}</span>}
      </span>
    </>
  );
  return (
    <li className={`tool-row ${off ? 'off' : ''} ${state.status === 'recommended' ? 'recommended' : ''}`}>
      {onRun ? (
        <button className="tool-main" aria-disabled={off} onClick={() => !off && onRun()}>
          {body}
        </button>
      ) : (
        <div className="tool-main">{body}</div>
      )}
      {control && <div className="tool-control">{control}</div>}
    </li>
  );
}

/** Un grupo de herramientas con su título y una frase que dice para qué sirven. */
export function ToolGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="tools-group">
      <h3>{title}</h3>
      <p className="small muted">{description}</p>
      <ul>{children}</ul>
    </section>
  );
}

/** Términos y su significado, uno por renglón. */
export function DefinitionList({ entries, narrow }: { entries: { term: ReactNode; definition: ReactNode }[]; narrow?: boolean }) {
  return (
    <dl className={`help-list ${narrow ? 'glossary' : ''}`}>
      {entries.map((e, i) => (
        <div key={i}>
          <dt>{e.term}</dt>
          <dd>{e.definition}</dd>
        </div>
      ))}
    </dl>
  );
}
