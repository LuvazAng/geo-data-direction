import type { Basemap } from '../MapView';

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

/** Barra sobre el mapa: mapa base, separar sentidos, todas las colonias y opacidad. */
export function MapToolbar({ basemap, onBasemap, lanes, onLanes, coloniasError, coloniasReady, showColonias, onShowColonias, opacity, onOpacity }: Props) {
  return (
    <div className="map-toolbar">
      {(['calles', 'satelite', 'oscuro'] as const).map((b) => (
        <button key={b} className={basemap === b ? 'active' : ''} onClick={() => onBasemap(b)}>
          {b === 'calles' ? 'Calles' : b === 'satelite' ? 'Satélite' : 'Oscuro'}
        </button>
      ))}
      <label className="check">
        <input type="checkbox" checked={lanes} onChange={(e) => onLanes(e.target.checked)} />
        Separar sentidos
      </label>
      <label
        className="check"
        title={coloniasError ? `Colonias: ${coloniasError}` : 'Todas las colonias de Morelos (INE); las del trazo seleccionado se pintan siempre'}
      >
        <input type="checkbox" checked={showColonias} disabled={!coloniasReady} onChange={(e) => onShowColonias(e.target.checked)} />
        {coloniasError ? 'Colonias no disponibles' : 'Todas las colonias'}
      </label>
      <label className="check opacity" title="Opacidad de todos los trazos (cada trazo tiene además la suya)">
        Opacidad
        <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} />
        <span className="small">{Math.round(opacity * 100)}%</span>
      </label>
    </div>
  );
}
