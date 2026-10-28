import type { CSSProperties } from 'react';
import { Icon, Popover } from '@ui';
import type { Route } from '../services/route';
import type { ToolDef } from '../tools/tools';

/** Las herramientas de edición del trazo que van siempre a la vista, en este orden. */
export const QUICK_TOOLS = ['snap', 'edit', 'simplify'] as const;
/** El resto de la edición del trazo, en el desplegable «Más». */
export const MENU_TOOLS = ['invert', 'undo', 'restore', 'zoom'] as const;

interface Props {
  tools: ToolDef[];
  /** El trazo que se edita, si hay uno elegido. */
  selected?: Route;
}

const reasonOf = (t: ToolDef) => (t.state.status === 'off' ? t.state.reason : undefined);

/**
 * Barra sobre el mapa con las herramientas del trazo seleccionado: tres de acceso rápido y un desplegable con el resto.
 * Usa las mismas herramientas del cajón (mismo estado y misma acción); sin trazo elegido se ven apagadas y dicen por qué.
 */
export function EditBar({ tools, selected }: Props) {
  const find = (ids: readonly string[]) => ids.map((id) => tools.find((t) => t.id === id)).filter((t): t is ToolDef => !!t);
  const quick = find(QUICK_TOOLS);
  const menu = find(MENU_TOOLS);
  const opacity = tools.find((t) => t.id === 'opacity');

  return (
    <div className="edit-bar" role="toolbar" aria-label="Edición del trazo seleccionado">
      <span className="edit-bar-who">
        {selected ? (
          <>
            <span className="badge" style={{ '--route-color': selected.color } as CSSProperties}>
              {selected.letter}
            </span>
            <span className="edit-bar-name">Editar el trazo</span>
          </>
        ) : (
          <span className="edit-bar-name muted">Edición del trazo</span>
        )}
      </span>

      {quick.map((t) => {
        const reason = reasonOf(t);
        return (
          <button
            key={t.id}
            className="quiet edit-tool"
            aria-pressed={!!t.active}
            aria-disabled={!!reason}
            aria-label={t.label}
            title={reason ?? `${t.description}${t.shortcut ? ` (${t.shortcut})` : ''}${t.active ? ' Pulsa de nuevo para cerrarla.' : ''}`}
            onClick={() => !reason && t.run?.()}
          >
            <Icon name={t.icon} />
            <span className="edit-tool-label">{t.label}</span>
          </button>
        );
      })}

      <Popover
        menu
        align="left"
        title="Más herramientas del trazo"
        label={
          <>
            <span className="edit-tool-label">Más</span>
            <Icon name="chevron-down" size={14} />
          </>
        }
      >
        {(close) => (
          <>
            {menu.map((t) => {
              const reason = reasonOf(t);
              return (
                <button
                  key={t.id}
                  className={`pop-item edit-menu-item${reason ? ' off' : ''}`}
                  aria-disabled={!!reason}
                  onClick={() => {
                    if (reason) return;
                    t.run?.();
                    close();
                  }}
                >
                  <Icon name={t.icon} />
                  <span className="edit-menu-text">
                    <span>
                      {t.label}
                      {t.shortcut && <kbd>{t.shortcut}</kbd>}
                      {t.state.status === 'recommended' && <span className="tool-badge">Recomendado ahora</span>}
                    </span>
                    {t.state.status === 'recommended' && <small className="tool-why">{t.state.why}</small>}
                    {reason && <small className="tool-reason">{reason}</small>}
                  </span>
                </button>
              );
            })}
            {opacity && (
              <div className={`edit-menu-opacity${reasonOf(opacity) ? ' off' : ''}`}>
                <span>
                  <Icon name={opacity.icon} /> {opacity.label}
                </span>
                {opacity.control}
                {reasonOf(opacity) && <small className="tool-reason">{reasonOf(opacity)}</small>}
              </div>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}
