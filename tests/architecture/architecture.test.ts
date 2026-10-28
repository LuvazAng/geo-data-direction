import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DIR } from '../../src/orchestrator/paths';
import { violations, type SourceFile } from './rules';

function sourcesUnder(dir: string, base = ''): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(join(PROJECT_DIR, dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sourcesUnder(dir, rel));
    else if (/\.tsx?$/.test(entry.name)) out.push({ path: `${dir}/${rel}`, source: readFileSync(join(PROJECT_DIR, dir, rel), 'utf8') });
  }
  return out;
}

const file = (path: string, ...imports: string[]): SourceFile => ({ path, source: imports.map((i) => `import { x } from '${i}';`).join('\n') });

describe('arquitectura: dependencias entre capas', () => {
  it('el código de src/ cumple las reglas', () => {
    const files = sourcesUnder('src');
    // que el recorrido no esté vacío: si no leyera nada, la prueba pasaría sin verificar nada
    const layers = ['src/core/', 'src/protocol/', 'src/editor/', 'src/control/', 'src/orchestrator/'];
    for (const layer of layers) expect(files.filter((f) => f.path.startsWith(layer)).length, layer).toBeGreaterThan(3);
    expect(files.map((f) => f.path)).toContain('src/App.tsx');
    expect(violations(files)).toEqual([]);
  });

  describe('detecta lo que está prohibido', () => {
    const found = (f: SourceFile) => violations([f]).join('\n');

    it('core no importa de otras capas ni de Node', () => {
      expect(found(file('src/core/a.ts', '@protocol'))).toContain('core no puede importar de protocol');
      expect(found(file('src/core/a.ts', '../editor/App'))).toContain('core no puede importar de editor');
      expect(found(file('src/core/a.ts', 'node:fs'))).toContain('no puede usar módulos de Node');
    });

    it('editor y control no se importan entre sí ni importan del orquestador', () => {
      expect(found(file('src/editor/a.ts', '../control/api'))).toContain('editor no puede importar de control');
      expect(found(file('src/control/a.ts', '../editor/App'))).toContain('control no puede importar de editor');
      expect(found(file('src/editor/a.ts', '../orchestrator/config'))).toContain('editor no puede importar de orchestrator');
      expect(found(file('src/control/a.ts', '../../src/orchestrator/config'))).toContain('control no puede importar de orchestrator');
    });

    it('el orquestador no importa de la interfaz', () => {
      expect(found(file('src/orchestrator/io/a.ts', '../../editor/App'))).toContain('orchestrator no puede importar de editor');
      expect(found(file('src/orchestrator/server/a.ts', '../../control/api'))).toContain('orchestrator no puede importar de control');
    });

    it('core y protocol se importan con su alias y sólo su API pública', () => {
      expect(found(file('src/editor/a.ts', '../core/kml'))).toContain("se importa con '@core'");
      expect(found(file('src/control/a.ts', '../protocol/events'))).toContain("se importa con '@protocol'");
      expect(found(file('src/editor/a.ts', '@core/kml'))).toContain("usa '@core'");
    });

    it('el orquestador respeta su orden interno (io < domain < llm < pipeline < server y cli)', () => {
      expect(found(file('src/orchestrator/io/a.ts', '../pipeline/pipeline'))).toContain('io no puede importar de pipeline');
      expect(found(file('src/orchestrator/domain/a.ts', '../llm/llm'))).toContain('domain no puede importar de llm');
      expect(found(file('src/orchestrator/pipeline/a.ts', '../server/jobs'))).toContain('pipeline no puede importar de server');
      expect(found(file('src/orchestrator/server/a.ts', '../cli/cli'))).toContain('server y cli no se importan entre sí');
      expect(found(file('src/orchestrator/domain/a.ts', '../config'))).toBe('');
    });
  });

  describe('permite lo que corresponde', () => {
    it.each([
      file('src/editor/components/a.tsx', '@core', '@protocol', '../services/geocode', 'react'),
      file('src/control/a.ts', '@core', '@protocol', './api'),
      file('src/App.tsx', './editor/components/MapView', './control/ControlCenter', '@core', './styles.css'),
      file('src/orchestrator/pipeline/a.ts', '../domain/classify', '../io/store', '../llm/llm', '../config', '@core', '@protocol', 'node:fs'),
      file('src/orchestrator/server/a.ts', '../pipeline/pipeline', '../errors', 'node:http'),
      file('src/protocol/a.ts', '@core', './events'),
    ])('$path', (f) => {
      expect(violations([f])).toEqual([]);
    });
  });
});
