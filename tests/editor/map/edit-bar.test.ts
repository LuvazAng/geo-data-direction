import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditBar, MENU_TOOLS, QUICK_TOOLS } from '../../../src/editor/map/EditBar';
import type { Route } from '../../../src/editor/services/route';
import type { ToolFacts } from '../../../src/editor/state/tools';
import { buildTools, type ToolsEnv } from '../../../src/editor/tools/tools';

const noop = () => {};
const facts = (over: Partial<ToolFacts> = {}): ToolFacts => ({
  hasRoutes: true,
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
  ...over,
});

const env = (f: ToolFacts, active = { edit: false, simplify: false, snap: false }): ToolsEnv => ({
  facts: f,
  reviewing: false,
  hasDir: false,
  tolerance: 50,
  setTolerance: noop,
  basemap: 'calles',
  setBasemap: noop,
  lanes: true,
  setLanes: noop,
  showColonias: false,
  setShowColonias: noop,
  routesOpacity: 1,
  setRoutesOpacity: noop,
  active,
  selectedOpacity: 1,
  setSelectedOpacity: noop,
  theme: 'oscuro',
  setTheme: noop,
  run: {
    openFolder: noop,
    openFiles: noop,
    saveAll: noop,
    saveAllAndNext: noop,
    saveReview: noop,
    exportKml: noop,
    invert: noop,
    edit: noop,
    simplify: noop,
    snap: noop,
    restore: noop,
    undo: noop,
    zoom: noop,
    suggestName: noop,
    fitAll: noop,
    newFolder: noop,
    splitDuplas: noop,
  },
});

const route = { letter: 'A', color: '#3b82f6' } as Route;
const render = (tools: ReturnType<typeof buildTools>, selected?: Route) => renderToString(createElement(EditBar, { tools, selected })).replace(/<!-- -->/g, '');

describe('EditBar', () => {
  it('los tres accesos rápidos son ajustar a calles, editar vértices y simplificar, en ese orden', () => {
    expect([...QUICK_TOOLS]).toEqual(['snap', 'edit', 'simplify']);
    const html = render(buildTools(env(facts({ hasSelection: true }))), route);
    const at = (label: string) => html.indexOf(`aria-label="${label}"`);
    expect(at('Ajustar a calles')).toBeGreaterThan(-1);
    expect(at('Ajustar a calles')).toBeLessThan(at('Editar vértices'));
    expect(at('Editar vértices')).toBeLessThan(at('Simplificar'));
  });

  it('todas las herramientas que usa existen en el registro', () => {
    const ids = buildTools(env(facts())).map((t) => t.id);
    for (const id of [...QUICK_TOOLS, ...MENU_TOOLS, 'opacity']) expect(ids, id).toContain(id);
  });

  it('sin trazo seleccionado se ven apagadas y dicen por qué, pero no desaparecen', () => {
    const html = render(buildTools(env(facts())));
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
    expect(html.match(/title="Selecciona un trazo en el mapa o en la lista\."/g)).toHaveLength(3);
    expect(html).toContain('Edición del trazo');
    expect(html).toContain('Más herramientas del trazo');
  });

  it('con un trazo seleccionado se ven disponibles y muestran su letra', () => {
    const html = render(buildTools(env(facts({ hasSelection: true }))), route);
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toMatch(/<span class="badge"[^>]*>A<\/span>/);
    expect(html).toContain('Editar el trazo');
  });

  it('la herramienta abierta se marca como activa y avisa que pulsarla otra vez la cierra', () => {
    const html = render(buildTools(env(facts({ hasSelection: true }), { edit: true, simplify: false, snap: false })), route);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Editar vértices"/);
    expect(html).toContain('Pulsa de nuevo para cerrarla.');
  });
});
