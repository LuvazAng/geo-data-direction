import { useRef } from 'react';
import { supportsFsAccess, type SourceFile } from '../../services/files';

interface Props {
  /** Ejecuciones del centro de control en curso (se muestra como insignia). */
  controlRunning: number;
  onOpenControl: () => void;
  busy: boolean;
  onPickFolder: () => void;
  onOpenFiles: (files: SourceFile[]) => void;
  /** Distancia máxima (m) para considerar que dos trazos coinciden. */
  tolerance: number;
  onTolerance: (tolerance: number) => void;
}

/** Título, acceso al centro de control, abrir carpeta o archivos y tolerancia. */
export function PanelHeader({ controlRunning, onOpenControl, busy, onPickFolder, onOpenFiles, tolerance, onTolerance }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="panel-header">
      <div className="row panel-title">
        <h1>Sentido de trayectos</h1>
        <button className="cc-open" onClick={onOpenControl} title="Procesamiento automático: chat, cola, archivos y consola">
          Centro de control
          {controlRunning > 0 && <span className="cc-open-badge">{controlRunning}</span>}
        </button>
      </div>
      <div className="row">
        {supportsFsAccess() && (
          <button className="primary" onClick={onPickFolder} disabled={busy}>
            Abrir carpeta
          </button>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
          Abrir archivos
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".kml,.kmz"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).map((file) => ({ file, path: file.name }));
            e.target.value = '';
            if (files.length) onOpenFiles(files);
          }}
        />
        <label className="tolerance" title="Distancia máxima para considerar que dos trazos coinciden">
          Tolerancia
          <input type="number" min={5} max={500} step={5} value={tolerance} onChange={(e) => onTolerance(Math.max(1, Number(e.target.value) || 50))} />m
        </label>
      </div>
    </header>
  );
}
