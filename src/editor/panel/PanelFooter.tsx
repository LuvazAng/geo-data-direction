import { Icon } from '@ui';

interface Props {
  hasRoutes: boolean;
  /** Hay una revisión de mapa en curso: los botones guardan y generan en el lote en vez de guardar archivos. */
  reviewing: boolean;
  busy: boolean;
  /** Hay acceso a una carpeta (si no, «Guardar todo» descarga un ZIP). */
  hasDir: boolean;
  /** Hay otra carpeta después de la actual. */
  hasNext: boolean;
  onSaveReview: () => void;
  onCancelReview: () => void;
  onSaveAll: () => void;
  onSaveAllAndNext: () => void;
  onOpenShortcuts: () => void;
}

/** La acción principal de guardar, y la ayuda de atajos. El resto del guardado está en Herramientas. */
export function PanelFooter({
  hasRoutes,
  reviewing,
  busy,
  hasDir,
  hasNext,
  onSaveReview,
  onCancelReview,
  onSaveAll,
  onSaveAllAndNext,
  onOpenShortcuts,
}: Props) {
  return (
    <footer className="panel-footer">
      {hasRoutes && (
        <div className="row">
          {reviewing ? (
            <>
              <button className="primary" onClick={onSaveReview} disabled={busy}>
                <Icon name="save" /> Guardar y generar
              </button>
              <button onClick={onCancelReview} disabled={busy}>
                Cancelar revisión
              </button>
            </>
          ) : (
            <>
              <button
                className="primary"
                onClick={onSaveAll}
                disabled={busy}
                title={hasDir ? 'Ctrl+S · escribe cada trazo en su carpeta' : 'Ctrl+S · sin acceso a la carpeta se descarga un ZIP'}
              >
                <Icon name={hasDir ? 'save' : 'download'} /> {hasDir ? 'Guardar todo' : 'Descargar ZIP'}
              </button>
              {hasNext && (
                <button onClick={onSaveAllAndNext} disabled={busy} title="Ctrl+Shift+S">
                  Guardar y siguiente <Icon name="chevron-right" />
                </button>
              )}
            </>
          )}
        </div>
      )}
      <button className="quiet help-link" onClick={onOpenShortcuts}>
        <Icon name="keyboard" /> Atajos de teclado
      </button>
    </footer>
  );
}
