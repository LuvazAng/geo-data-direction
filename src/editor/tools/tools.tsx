import type { ReactNode } from 'react';
import type { IconName, Theme } from '@ui';
import type { Basemap } from '../map/basemap';
import { toolStates, type ToolFacts, type ToolId, type ToolState } from '../state/tools';

export type ToolGroupId = 'archivos' | 'trazo' | 'organizar' | 'mapa';

export interface ToolDef {
  id: ToolId;
  group: ToolGroupId;
  icon: IconName;
  label: string;
  description: string;
  shortcut?: string;
  state: ToolState;
  /** Qué hace al pulsarla. Las que sólo tienen `control` se manejan desde él. */
  run?: () => void;
  /** La herramienta está abierta ahora en el trazo seleccionado (pulsarla otra vez la cierra). */
  active?: boolean;
  /** El cajón sigue abierto al usarla (ajustes cuyo efecto se mira en el mapa). */
  keepOpen?: boolean;
  control?: ReactNode;
}

export const GROUPS: { id: ToolGroupId; title: string; description: string }[] = [
  { id: 'archivos', title: 'Abrir y guardar', description: 'Trae tus rutas y guarda el resultado.' },
  { id: 'trazo', title: 'Trazo seleccionado', description: 'Cambian el trazo que tienes marcado en la lista.' },
  { id: 'organizar', title: 'Organizar', description: 'Ordena los trazos en carpetas y define cómo se comparan.' },
  { id: 'mapa', title: 'Mapa y apariencia', description: 'Cómo se ve el mapa y la aplicación.' },
];

export interface ToolsEnv {
  facts: ToolFacts;
  reviewing: boolean;
  hasDir: boolean;
  tolerance: number;
  setTolerance: (m: number) => void;
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
  lanes: boolean;
  setLanes: (on: boolean) => void;
  showColonias: boolean;
  setShowColonias: (on: boolean) => void;
  routesOpacity: number;
  setRoutesOpacity: (n: number) => void;
  /** Qué herramientas de forma están abiertas en el trazo seleccionado. */
  active: { edit: boolean; simplify: boolean; snap: boolean };
  selectedOpacity: number;
  setSelectedOpacity: (n: number) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  run: {
    openFolder: () => void;
    openFiles: () => void;
    saveAll: () => void;
    saveAllAndNext: () => void;
    saveReview: () => void;
    exportKml: () => void;
    invert: () => void;
    edit: () => void;
    simplify: () => void;
    snap: () => void;
    restore: () => void;
    undo: () => void;
    zoom: () => void;
    suggestName: () => void;
    fitAll: () => void;
    newFolder: () => void;
    splitDuplas: () => void;
  };
}

const percent = (n: number) => `${Math.round(n * 100)}%`;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Slider({ value, onChange, label, disabled }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <label className="tool-slider">
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="small">{percent(value)}</span>
    </label>
  );
}

/** Todas las herramientas del editor con su estado actual. Ninguna falta nunca: las que no aplican explican por qué. */
export function buildTools(env: ToolsEnv): ToolDef[] {
  const s = toolStates(env.facts);
  const { run } = env;
  return [
    {
      id: 'open-folder',
      group: 'archivos',
      icon: 'folder-open',
      label: 'Abrir carpeta',
      description: 'Elige una carpeta con tus KML/KMZ. Cada subcarpeta se revisa por separado y N / P pasan de una a otra.',
      state: s['open-folder'],
      run: run.openFolder,
    },
    {
      id: 'open-files',
      group: 'archivos',
      icon: 'file',
      label: 'Abrir archivos',
      description: 'Abre uno o varios KML/KMZ sueltos. También puedes arrastrarlos a la ventana.',
      state: s['open-files'],
      run: run.openFiles,
    },
    {
      id: 'save-all',
      group: 'archivos',
      icon: 'save',
      label: env.reviewing ? 'Guardar y generar' : env.hasDir ? 'Guardar todo' : 'Descargar ZIP',
      description: env.reviewing
        ? 'Registra en el lote los trazos que quedaron y genera cada KML.'
        : env.hasDir
          ? 'Escribe cada trazo en su carpeta, junto al archivo original.'
          : 'No hay acceso a la carpeta: descarga todos los trazos en un ZIP.',
      shortcut: 'Ctrl+S',
      state: s['save-all'],
      run: env.reviewing ? run.saveReview : run.saveAll,
    },
    {
      id: 'save-next',
      group: 'archivos',
      icon: 'chevron-right',
      label: 'Guardar y siguiente',
      description: 'Guarda esta carpeta y abre la siguiente de la lista.',
      shortcut: 'Ctrl+Shift+S',
      state: s['save-next'],
      run: run.saveAllAndNext,
    },
    {
      id: 'export-kml',
      group: 'archivos',
      icon: 'download',
      label: 'KML con carpetas',
      description: 'Un solo KML con todas las carpetas, para revisarlo en Google Earth.',
      state: s['export-kml'],
      run: run.exportKml,
    },
    {
      id: 'invert',
      group: 'trazo',
      icon: 'swap',
      label: 'Invertir sentido',
      description: 'Cambia el sentido del trazo: el INICIO pasa a ser el FINAL y al revés.',
      shortcut: 'R',
      state: s.invert,
      run: run.invert,
    },
    {
      id: 'edit',
      group: 'trazo',
      icon: 'vertices',
      label: 'Editar vértices',
      description: 'Mueve, agrega o quita vértices arrastrando sobre el mapa.',
      shortcut: 'E',
      state: s.edit,
      active: env.active.edit,
      run: run.edit,
    },
    {
      id: 'simplify',
      group: 'trazo',
      icon: 'simplify',
      label: 'Simplificar',
      description: 'Quita los puntos que sobran sin cambiar la forma del trazo, con vista previa de cuántos quedan.',
      state: s.simplify,
      active: env.active.simplify,
      run: run.simplify,
    },
    {
      id: 'snap',
      group: 'trazo',
      icon: 'streets',
      label: 'Ajustar a calles',
      description: 'Acomoda el trazo sobre las calles de OpenStreetMap y muestra el resultado antes de aplicarlo.',
      state: s.snap,
      active: env.active.snap,
      run: run.snap,
    },
    {
      id: 'restore',
      group: 'trazo',
      icon: 'restore',
      label: 'Restaurar',
      description: 'Devuelve el trazo a la geometría que traía el archivo.',
      state: s.restore,
      run: run.restore,
    },
    {
      id: 'undo',
      group: 'trazo',
      icon: 'undo',
      label: 'Deshacer',
      description: 'Deshace el último cambio de geometría del trazo.',
      shortcut: 'Ctrl+Z',
      state: s.undo,
      run: run.undo,
      keepOpen: true,
    },
    {
      id: 'zoom',
      group: 'trazo',
      icon: 'locate',
      label: 'Ver en el mapa',
      description: 'Acerca el mapa al trazo seleccionado.',
      state: s.zoom,
      run: run.zoom,
    },
    {
      id: 'suggest-name',
      group: 'trazo',
      icon: 'sparkles',
      label: 'Sugerir nombre',
      description: 'Arma el nombre RUTA-ORIGEN-DESTINO con la colonia donde empieza y donde termina el trazo, y lo compara con el original.',
      state: s['suggest-name'],
      run: run.suggestName,
    },
    {
      id: 'opacity',
      group: 'trazo',
      icon: 'opacity',
      label: 'Opacidad del trazo',
      description: 'Qué tan visible se ve este trazo en el mapa. No cambia el archivo.',
      state: s.opacity,
      control: (
        <Slider value={env.selectedOpacity} onChange={env.setSelectedOpacity} label="Opacidad del trazo seleccionado" disabled={s.opacity.status === 'off'} />
      ),
    },
    {
      id: 'new-folder',
      group: 'organizar',
      icon: 'folder-plus',
      label: 'Nueva carpeta',
      description: 'Crea una carpeta para ordenar los trazos. Usa / para subcarpetas, por ejemplo 1/ALTERNAS.',
      state: s['new-folder'],
      run: run.newFolder,
    },
    {
      id: 'split-duplas',
      group: 'organizar',
      icon: 'split',
      label: 'Separar en carpetas por dupla',
      description: 'Pone cada dupla, con sus ampliaciones y rutas alternas, en su propia carpeta (1, 2…).',
      state: s['split-duplas'],
      run: run.splitDuplas,
    },
    {
      id: 'tolerance',
      group: 'organizar',
      icon: 'compare',
      label: 'Tolerancia de comparación',
      description: 'Distancia máxima, en metros, para decidir que dos trazos coinciden al compararlos.',
      state: s.tolerance,
      control: (
        <label className="tool-number">
          <input
            type="number"
            min={5}
            max={500}
            step={5}
            value={env.tolerance}
            aria-label="Tolerancia en metros"
            onChange={(e) => env.setTolerance(Math.max(1, Number(e.target.value) || 50))}
          />
          <span className="muted small">m</span>
        </label>
      ),
    },
    {
      id: 'fit-all',
      group: 'mapa',
      icon: 'map',
      label: 'Ver todos los trazos',
      description: 'Encuadra todos los trazos en el mapa.',
      shortcut: 'F',
      state: s['fit-all'],
      run: run.fitAll,
    },
    {
      id: 'basemap',
      group: 'mapa',
      icon: 'map',
      label: 'Mapa base',
      description: 'Calles, satélite u oscuro.',
      state: s.basemap,
      control: (
        <Seg
          label="Mapa base"
          value={env.basemap}
          onChange={env.setBasemap}
          options={[
            ['calles', 'Calles'],
            ['satelite', 'Satélite'],
            ['oscuro', 'Oscuro'],
          ]}
        />
      ),
    },
    {
      id: 'lanes',
      group: 'mapa',
      icon: 'swap',
      label: 'Separar sentidos',
      description: 'Dibuja cada sentido a un lado de la calle para distinguir la ida del regreso.',
      state: s.lanes,
      control: (
        <label className="check">
          <input type="checkbox" checked={env.lanes} onChange={(e) => env.setLanes(e.target.checked)} /> {env.lanes ? 'Activado' : 'Desactivado'}
        </label>
      ),
    },
    {
      id: 'colonias',
      group: 'mapa',
      icon: 'layers',
      label: 'Todas las colonias',
      description: 'Dibuja de fondo todas las colonias de Morelos (INE). Las del trazo seleccionado se pintan siempre.',
      state: s.colonias,
      control: (
        <label className="check">
          <input type="checkbox" checked={env.showColonias} disabled={s.colonias.status === 'off'} onChange={(e) => env.setShowColonias(e.target.checked)} />{' '}
          {env.showColonias ? 'Activado' : 'Desactivado'}
        </label>
      ),
    },
    {
      id: 'routes-opacity',
      group: 'mapa',
      icon: 'opacity',
      label: 'Opacidad de todos los trazos',
      description: 'Qué tan visibles se ven todos los trazos en el mapa (cada trazo tiene además la suya).',
      state: s['routes-opacity'],
      control: <Slider value={env.routesOpacity} onChange={env.setRoutesOpacity} label="Opacidad de todos los trazos" />,
    },
    {
      id: 'theme',
      group: 'mapa',
      icon: env.theme === 'claro' ? 'sun' : 'moon',
      label: 'Tema',
      description: 'Oscuro o claro. Se recuerda en este navegador.',
      state: s.theme,
      control: (
        <Seg
          label="Tema"
          value={env.theme}
          onChange={env.setTheme}
          options={[
            ['oscuro', 'Oscuro'],
            ['claro', 'Claro'],
          ]}
        />
      ),
    },
  ];
}
