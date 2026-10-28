// Cuándo se puede usar cada herramienta del editor y cuándo conviene. Ninguna se oculta: si no aplica, se dice por qué.

export type ToolId =
  | 'open-folder'
  | 'open-files'
  | 'save-all'
  | 'save-next'
  | 'export-kml'
  | 'invert'
  | 'edit'
  | 'simplify'
  | 'snap'
  | 'restore'
  | 'undo'
  | 'zoom'
  | 'suggest-name'
  | 'opacity'
  | 'fit-all'
  | 'new-folder'
  | 'split-duplas'
  | 'tolerance'
  | 'basemap'
  | 'lanes'
  | 'colonias'
  | 'routes-opacity'
  | 'theme';

export type ToolState = { status: 'ready' } | { status: 'recommended'; why: string } | { status: 'off'; reason: string };

/** Lo que el editor sabe en este momento. */
export interface ToolFacts {
  hasRoutes: boolean;
  hasSelection: boolean;
  /** Se está resolviendo a mano un mapa del orquestador desde el centro de control. */
  reviewing: boolean;
  /** El nombre del trazo seleccionado ya tiene la forma RUTA-ORIGEN-DESTINO. */
  selectedNameFormatOk: boolean;
  /** El trazo seleccionado ya no tiene la geometría del archivo. */
  selectedEdited: boolean;
  selectedHasHistory: boolean;
  /** Por qué parece ir al revés el trazo seleccionado (vacío si no hay motivo). */
  invertReasons: string[];
  /** El navegador puede abrir una carpeta entera. */
  canPickFolder: boolean;
  /** Se abrió una carpeta con varias subcarpetas que recorrer. */
  hasGroups: boolean;
  hasNext: boolean;
  /** Hay duplas o tramos cortos que se pueden separar en carpetas. */
  canSplit: boolean;
  /** Quedan trazos sin carpeta. */
  hasLooseRoutes: boolean;
  coloniasReady: boolean;
  /** Por qué no están disponibles las colonias, si no lo están. */
  coloniasError?: string;
}

const NEED_ROUTES = 'Abre rutas primero.';
const NEED_SELECTION = 'Selecciona un trazo en el mapa o en la lista.';

const ready: ToolState = { status: 'ready' };
const off = (reason: string): ToolState => ({ status: 'off', reason });

/** Un trazo seleccionado es requisito de todas las herramientas de «Trazo seleccionado». */
const needsSelection = (f: ToolFacts): ToolState => (f.hasSelection ? ready : off(NEED_SELECTION));

export function toolStates(f: ToolFacts): Record<ToolId, ToolState> {
  return {
    'open-folder': !f.canPickFolder
      ? off('Este navegador no puede abrir carpetas; usa Chrome o Edge, o abre archivos sueltos.')
      : f.hasRoutes
        ? ready
        : { status: 'recommended', why: 'Empieza por aquí.' },
    'open-files': ready,
    'save-all': f.hasRoutes ? ready : off(NEED_ROUTES),
    'save-next': !f.hasRoutes
      ? off(NEED_ROUTES)
      : !f.hasGroups
        ? off('Se usa al recorrer una carpeta con varias subcarpetas.')
        : f.hasNext
          ? ready
          : off('Esta es la última carpeta.'),
    'export-kml': f.hasRoutes ? ready : off(NEED_ROUTES),
    invert: !f.hasSelection
      ? off(NEED_SELECTION)
      : f.invertReasons.length > 0
        ? { status: 'recommended', why: `Parece ir al revés según ${f.invertReasons.join(' y ')}.` }
        : ready,
    edit: needsSelection(f),
    simplify: needsSelection(f),
    snap: needsSelection(f),
    restore: !f.hasSelection ? off(NEED_SELECTION) : f.selectedEdited ? ready : off('Este trazo todavía no se ha editado.'),
    undo: !f.hasSelection ? off(NEED_SELECTION) : f.selectedHasHistory ? ready : off('Este trazo no tiene cambios de geometría que deshacer.'),
    zoom: needsSelection(f),
    'suggest-name': !f.reviewing
      ? off('Se usa al resolver un mapa desde el centro de control.')
      : !f.hasSelection
        ? off(NEED_SELECTION)
        : !f.coloniasReady
          ? off(f.coloniasError ?? 'Las colonias todavía no se han cargado.')
          : f.selectedNameFormatOk
            ? ready
            : { status: 'recommended', why: 'El nombre actual no sigue la forma RUTA-ORIGEN-DESTINO.' },
    opacity: needsSelection(f),
    'fit-all': f.hasRoutes ? ready : off(NEED_ROUTES),
    'new-folder': f.hasRoutes ? ready : off(NEED_ROUTES),
    'split-duplas': !f.canSplit
      ? off('Aparece cuando hay más de dos trazos o tramos cortos que se relacionan.')
      : f.hasLooseRoutes
        ? { status: 'recommended', why: 'Hay trazos sin carpeta; cada dupla puede ir a la suya.' }
        : ready,
    tolerance: ready,
    basemap: ready,
    lanes: ready,
    colonias: f.coloniasReady ? ready : off(f.coloniasError ?? 'Las colonias todavía no se han cargado.'),
    'routes-opacity': ready,
    theme: ready,
  };
}
