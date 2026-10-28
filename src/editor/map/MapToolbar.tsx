import { Popover } from '@ui';
import type { Basemap } from './basemap';

interface Props {
  basemap: Basemap;
  onBasemap: (basemap: Basemap) => void;
  lanes: boolean;
  onLanes: (lanes: boolean) => void;
  /** Si no se pudieron cargar las colonias. */
  coloniasError?: string;
  coloniasReady: boolean;
  showColonias: boolean;
  onShowColonias: (show: boolean) => void;
  /** Opacidad general de los trazos en el mapa (0.1–1). */
  opacity: number;
  onOpacity: (opacity: number) => void;
}

/** Barra sobre el mapa: el mapa base a la vista y, en «Capas», lo que se enciende o apaga encima. */
export function MapToolbar({ basemap, onBasemap, lanes, onLanes, coloniasError, coloniasReady, showColonias, onShowColonias, opacity, onOpacity }: Props) {
  return (
    <div className="map-toolbar">
      <div className="seg" role="group" aria-label="Mapa base">
        {(['calles', 'satelite', 'oscuro'] as const).map((b) => (
          <button key={b} aria-pressed={basemap === b} onClick={() => onBasemap(b)}>
            {b === 'calles' ? 'Calles' : b === 'satelite' ? 'Satélite' : 'Oscuro'}
          </button>
        ))}
      </div>
      <Popover label="Capas" icon="layers">
        <label className="check">
          <input type="checkbox" checked={lanes} onChange={(e) => onLanes(e.target.checked)} />
          <span>
            Separar sentidos
            <small className="muted">Cada sentido a un lado de la calle.</small>
          </span>
        </label>
        <label className="check" title={coloniasError ? `Colonias: ${coloniasError}` : undefined}>
          <input type="checkbox" checked={showColonias} disabled={!coloniasReady} onChange={(e) => onShowColonias(e.target.checked)} />
          <span>
            {coloniasError ? 'Colonias no disponibles' : 'Todas las colonias'}
            <small className="muted">{coloniasError ? coloniasError : 'Las del trazo seleccionado se pintan siempre.'}</small>
          </span>
        </label>
        <label className="layers-opacity">
          <span>Opacidad de los trazos</span>
          <span className="row">
            <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} />
            <span className="small">{Math.round(opacity * 100)}%</span>
          </span>
        </label>
      </Popover>
    </div>
  );
}
