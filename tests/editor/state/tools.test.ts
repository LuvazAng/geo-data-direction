import { describe, expect, it } from 'vitest';
import { toolStates, type ToolFacts, type ToolId } from '../../../src/editor/state/tools';

const empty: ToolFacts = {
  hasRoutes: false,
  hasSelection: false,
  reviewing: false,
  selectedNameFormatOk: false,
  selectedEdited: false,
  selectedHasHistory: false,
  invertReasons: [],
  canPickFolder: true,
  hasGroups: false,
  hasNext: false,
  canSplit: false,
  hasLooseRoutes: false,
  coloniasReady: true,
};
const loaded: ToolFacts = { ...empty, hasRoutes: true };
const selected: ToolFacts = { ...loaded, hasSelection: true };

const reason = (facts: ToolFacts, id: ToolId) => {
  const s = toolStates(facts)[id];
  return s.status === 'off' ? s.reason : null;
};

describe('toolStates', () => {
  it('sin rutas abiertas, abrir carpeta es lo recomendado y guardar dice que falta abrir rutas', () => {
    const s = toolStates(empty);
    expect(s['open-folder']).toEqual({ status: 'recommended', why: 'Empieza por aquí.' });
    expect(s['open-files']).toEqual({ status: 'ready' });
    expect(reason(empty, 'save-all')).toBe('Abre rutas primero.');
    expect(reason(empty, 'fit-all')).toBe('Abre rutas primero.');
  });

  it('ninguna herramienta desaparece: todas tienen estado en cualquier situación', () => {
    const ids = Object.keys(toolStates(empty)).sort();
    for (const facts of [empty, loaded, selected]) expect(Object.keys(toolStates(facts)).sort()).toEqual(ids);
  });

  it('las herramientas de un trazo piden seleccionarlo, con el motivo escrito', () => {
    for (const id of ['invert', 'edit', 'simplify', 'snap', 'restore', 'undo', 'zoom', 'opacity'] as const) {
      expect(reason(loaded, id), id).toBe('Selecciona un trazo en el mapa o en la lista.');
    }
    // con un trazo seleccionado quedan disponibles (restaurar y deshacer además piden que haya cambios)
    for (const id of ['invert', 'edit', 'simplify', 'snap', 'zoom', 'opacity'] as const) expect(toolStates(selected)[id].status, id).not.toBe('off');
  });

  it('restaurar y deshacer sólo valen si el trazo cambió', () => {
    expect(reason(selected, 'restore')).toBe('Este trazo todavía no se ha editado.');
    expect(reason(selected, 'undo')).toBe('Este trazo no tiene cambios de geometría que deshacer.');
    const changed = { ...selected, selectedEdited: true, selectedHasHistory: true };
    expect(toolStates(changed).restore).toEqual({ status: 'ready' });
    expect(toolStates(changed).undo).toEqual({ status: 'ready' });
  });

  it('invertir se recomienda sólo cuando hay un motivo real, y lo dice', () => {
    expect(toolStates(selected).invert).toEqual({ status: 'ready' });
    const s = toolStates({ ...selected, invertReasons: ['la descripción', 'las calles de un sentido'] }).invert;
    expect(s).toEqual({ status: 'recommended', why: 'Parece ir al revés según la descripción y las calles de un sentido.' });
  });

  it('guardar y siguiente distingue "no hay subcarpetas" de "es la última"', () => {
    expect(reason(loaded, 'save-next')).toBe('Se usa al recorrer una carpeta con varias subcarpetas.');
    expect(reason({ ...loaded, hasGroups: true }, 'save-next')).toBe('Esta es la última carpeta.');
    expect(toolStates({ ...loaded, hasGroups: true, hasNext: true })['save-next']).toEqual({ status: 'ready' });
  });

  it('separar por dupla aparece apagada con su motivo, y se recomienda si quedan trazos sin carpeta', () => {
    expect(reason(loaded, 'split-duplas')).toContain('más de dos trazos');
    expect(toolStates({ ...loaded, canSplit: true })['split-duplas']).toEqual({ status: 'ready' });
    expect(toolStates({ ...loaded, canSplit: true, hasLooseRoutes: true })['split-duplas'].status).toBe('recommended');
  });

  it('sin soporte de carpetas lo dice; las colonias dan el motivo de su error', () => {
    expect(reason({ ...empty, canPickFolder: false }, 'open-folder')).toContain('Chrome o Edge');
    expect(reason({ ...empty, coloniasReady: false, coloniasError: 'falta colonias-morelos.geojson' }, 'colonias')).toBe('falta colonias-morelos.geojson');
    expect(reason({ ...empty, coloniasReady: false }, 'colonias')).toBe('Las colonias todavía no se han cargado.');
  });

  it('sugerir nombre sólo se ofrece al resolver un mapa desde el centro de control, y dice por qué no', () => {
    expect(reason(selected, 'suggest-name')).toBe('Se usa al resolver un mapa desde el centro de control.');
    expect(reason({ ...loaded, reviewing: true }, 'suggest-name')).toBe('Selecciona un trazo en el mapa o en la lista.');
    expect(reason({ ...selected, reviewing: true, coloniasReady: false }, 'suggest-name')).toBe('Las colonias todavía no se han cargado.');
    expect(reason({ ...selected, reviewing: true, coloniasReady: false, coloniasError: 'falta el archivo de colonias' }, 'suggest-name')).toBe(
      'falta el archivo de colonias',
    );
  });

  it('sugerir nombre se recomienda cuando el nombre actual no sigue RUTA-ORIGEN-DESTINO', () => {
    const resolving = { ...selected, reviewing: true };
    expect(toolStates(resolving)['suggest-name']).toEqual({ status: 'recommended', why: 'El nombre actual no sigue la forma RUTA-ORIGEN-DESTINO.' });
    expect(toolStates({ ...resolving, selectedNameFormatOk: true })['suggest-name']).toEqual({ status: 'ready' });
  });

  it('los ajustes de mapa y apariencia siempre están disponibles', () => {
    for (const id of ['tolerance', 'basemap', 'lanes', 'routes-opacity', 'theme'] as const) expect(toolStates(empty)[id], id).toEqual({ status: 'ready' });
  });
});
