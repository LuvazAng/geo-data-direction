import { fileURLToPath } from 'node:url';

// Alias de importación para Vite y Vitest (TypeScript y tsx los leen de `paths` en tsconfig.json).
// Cada capa expone su API en un index.ts; las demás capas importan de ahí.
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const aliases = [
  { find: /^@core$/, replacement: at('src/core/index.ts') },
  { find: /^@protocol$/, replacement: at('src/protocol/index.ts') },
  { find: /^@ui$/, replacement: at('src/ui/index.ts') },
];
