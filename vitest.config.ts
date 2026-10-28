import { defineConfig } from 'vitest/config';
import { aliases } from './tools/aliases.ts';

// Pruebas del orquestador (Node). La app web no tiene pruebas propias.
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/orchestrator/io/dom.ts'],
    testTimeout: 60_000,
  },
});
