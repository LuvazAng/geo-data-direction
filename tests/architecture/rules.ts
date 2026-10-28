import { posix } from 'node:path';

// Reglas de dependencia entre las capas de src/ (ver docs/architecture.md). Funciones puras sobre
// rutas y texto: la prueba las aplica al código real y a ejemplos inventados.

export type Layer = 'core' | 'protocol' | 'editor' | 'control' | 'shell' | 'orchestrator';

/** De qué capas puede importar cada una (además de sí misma). */
const ALLOWED: Record<Layer, Layer[]> = {
  core: [],
  protocol: ['core'],
  editor: ['core', 'protocol'],
  control: ['core', 'protocol'],
  shell: ['core', 'protocol', 'editor', 'control'],
  orchestrator: ['core', 'protocol'],
};

/** Capas que se usan con alias: sólo se importa su API pública (index.ts), nunca sus archivos. */
const ALIASES: Record<string, Layer> = { '@core': 'core', '@protocol': 'protocol' };

/** Raíz de composición de la app web: junta el editor y el centro de control. */
const SHELL_FILES = new Set(['src/App.tsx', 'src/main.tsx', 'src/vite-env.d.ts']);

export function layerOf(path: string): Layer | null {
  if (SHELL_FILES.has(path)) return 'shell';
  const m = /^src\/(core|protocol|editor|control|orchestrator)\//.exec(path);
  return m ? (m[1] as Layer) : null;
}

/** Dentro del orquestador una carpeta sólo importa de las de abajo (o de sí misma). */
const ORCHESTRATOR_RANK: Record<string, number> = { base: 0, io: 1, domain: 2, llm: 3, pipeline: 4, server: 5, cli: 5 };

function orchestratorPart(path: string): string | null {
  const m = /^src\/orchestrator\/([^/]+)\//.exec(path);
  if (m) return m[1] in ORCHESTRATOR_RANK ? m[1] : null;
  return /^src\/orchestrator\/[^/]+\.ts$/.test(path) ? 'base' : null;
}

/** Rutas de importación de un archivo (import, export … from, import dinámico). */
export function importsOf(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g)) out.push(m[2]);
  return out;
}

export interface SourceFile {
  path: string;
  source: string;
}

/** Violaciones de las reglas, una por línea y legibles. Vacío si todo está en orden. */
export function violations(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const { path, source } of files) {
    const layer = layerOf(path);
    if (!layer) continue;
    for (const spec of importsOf(source)) {
      const where = `${path} importa '${spec}'`;
      if (layer !== 'orchestrator' && spec.startsWith('node:')) {
        out.push(`${where}: ${layer} corre en el navegador y no puede usar módulos de Node`);
        continue;
      }
      // alias: sólo la API pública
      const alias = Object.keys(ALIASES).find((a) => spec === a || spec.startsWith(`${a}/`));
      if (alias) {
        const target = ALIASES[alias];
        if (spec !== alias) out.push(`${where}: importa un archivo interno de ${target}; usa '${alias}'`);
        else if (target !== layer && !ALLOWED[layer].includes(target)) out.push(`${where}: ${layer} no puede importar de ${target}`);
        continue;
      }
      if (!spec.startsWith('.')) continue; // paquete externo
      const resolved = posix.normalize(posix.join(posix.dirname(path), spec));
      const target = layerOf(`${resolved}.ts`) ?? layerOf(`${resolved}/index.ts`) ?? layerOf(resolved);
      if (!target || target === layer) {
        if (layer === 'orchestrator' && target === 'orchestrator') orchestratorOrder(path, resolved, where, out);
        continue;
      }
      if (!ALLOWED[layer].includes(target)) {
        out.push(`${where}: ${layer} no puede importar de ${target}`);
      } else if (Object.values(ALIASES).includes(target)) {
        out.push(`${where}: ${target} se importa con '@${target}', no con una ruta relativa`);
      }
    }
  }
  return out;
}

function orchestratorOrder(path: string, resolved: string, where: string, out: string[]) {
  const from = orchestratorPart(path);
  const to = orchestratorPart(`${resolved}.ts`) ?? orchestratorPart(`${resolved}/index.ts`);
  if (!from || !to || from === to) return;
  if (from !== 'base' && to !== 'base' && ORCHESTRATOR_RANK[to] === ORCHESTRATOR_RANK[from]) {
    out.push(`${where}: ${from} y ${to} no se importan entre sí`);
  } else if (ORCHESTRATOR_RANK[to] > ORCHESTRATOR_RANK[from]) {
    out.push(`${where}: ${from} no puede importar de ${to} (va por encima en el orquestador)`);
  }
}
