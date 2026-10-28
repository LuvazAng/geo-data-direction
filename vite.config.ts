import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aliases } from './tools/aliases.ts';

// Centro de control: /api va al servidor local (npm run centro). El proxy agrega el token que el
// servidor guardó en .centro/token, así el navegador nunca lo ve ni lo necesita.
const CENTRO = process.env.CENTRO_URL ?? `http://127.0.0.1:${process.env.CENTRO_PORT ?? 5198}`;
const TOKEN_FILE = process.env.CENTRO_TOKEN_ARCHIVO ?? fileURLToPath(new URL('./.centro/token', import.meta.url));

let token = '';
const centroToken = () => {
  if (!token) {
    try {
      token = readFileSync(TOKEN_FILE, 'utf8').trim();
    } catch {
      token = ''; // el servidor todavía no se ha iniciado nunca
    }
  }
  return token;
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  server: {
    port: 5199,
    proxy: {
      '/api': {
        target: CENTRO,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            const t = centroToken();
            if (t) req.setHeader('x-centro-token', t);
          });
          // si el servidor se reinició con otro token, se vuelve a leer en la siguiente petición
          proxy.on('proxyRes', (res) => {
            if (res.statusCode === 401) token = '';
          });
        },
      },
    },
  },
  // MapLibre 6 corre su worker como módulo ES
  worker: { format: 'es' },
});
