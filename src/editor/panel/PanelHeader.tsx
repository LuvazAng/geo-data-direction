import { Icon } from '@ui';

interface Props {
  /** Ejecuciones del centro de control en curso (se muestra como insignia). */
  controlRunning: number;
  onOpenControl: () => void;
  busy: boolean;
  hasRoutes: boolean;
  /** El navegador puede abrir una carpeta entera. */
  canPickFolder: boolean;
  onPickFolder: () => void;
  onOpenFiles: () => void;
  onOpenTools: () => void;
}

/** Título y qué hacer, abrir rutas, el cajón de herramientas y el acceso al centro de control. */
export function PanelHeader({ controlRunning, onOpenControl, busy, hasRoutes, canPickFolder, onPickFolder, onOpenFiles, onOpenTools }: Props) {
  return (
    <header className="panel-header">
      <div className="row panel-title">
        <h1>Sentido de trayectos</h1>
        <span className="spacer" />
        <button className="cc-open" onClick={onOpenControl} title="Procesamiento automático: chat, cola, archivos y consola">
          Centro de control
          {controlRunning > 0 && <span className="cc-open-badge">{controlRunning}</span>}
        </button>
      </div>
      <p className="panel-sub">
        {hasRoutes
          ? 'Elige un trazo para ver su sentido. Lo demás está en Herramientas.'
          : 'Revisa que cada recorrido vaya de INICIO a FINAL y corrígelo si hace falta.'}
      </p>
      <div className="row panel-actions">
        {/* sin rutas abiertas, abrir carpeta y archivos está en la bienvenida */}
        {hasRoutes && canPickFolder && (
          <button onClick={onPickFolder} disabled={busy}>
            <Icon name="folder-open" /> Abrir carpeta
          </button>
        )}
        {hasRoutes && (
          <button onClick={onOpenFiles} disabled={busy}>
            <Icon name="file" /> Abrir archivos
          </button>
        )}
        <span className="spacer" />
        <button onClick={onOpenTools}>
          <Icon name="tools" /> Herramientas
        </button>
      </div>
    </header>
  );
}
