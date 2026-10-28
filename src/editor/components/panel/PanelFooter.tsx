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
  onExport: () => void;
}

/** Botones de guardar y exportar, y la ayuda de atajos. */
export function PanelFooter({ hasRoutes, reviewing, busy, hasDir, hasNext, onSaveReview, onCancelReview, onSaveAll, onSaveAllAndNext, onExport }: Props) {
  return (
    <footer className="panel-footer">
      {hasRoutes && (
        <div className="row">
          {reviewing ? (
            <>
              <button className="primary" onClick={onSaveReview} disabled={busy}>
                Guardar y generar
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
                {hasDir ? 'Guardar todo' : 'Descargar ZIP'}
              </button>
              {hasNext && (
                <button className="primary" onClick={onSaveAllAndNext} disabled={busy} title="Ctrl+Shift+S">
                  Guardar y siguiente ▶
                </button>
              )}
              <button onClick={onExport} disabled={busy} title="Un solo KML con todas las carpetas, para revisarlo en Google Earth">
                KML con carpetas
              </button>
            </>
          )}
        </div>
      )}
      <p className="shortcuts">
        <kbd>1-9</kbd> elegir · <kbd>R</kbd> invertir · <kbd>E</kbd> editar · <kbd>Supr</kbd> eliminar · <kbd>Ctrl+Z</kbd> deshacer · <kbd>F</kbd> encuadrar ·{' '}
        <kbd>N</kbd>/<kbd>P</kbd> carpeta · <kbd>Ctrl+S</kbd> guardar · <kbd>Ctrl+Shift+S</kbd> guardar y siguiente
      </p>
    </footer>
  );
}
