import '../io/dom';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Center } from './center';
import { loadCenterConfig, loadLotes } from './config';
import { loadEnv } from '../paths';
import { createCenterServer } from './http';
import { pipelineRunner } from './runner';

// Servidor del centro de control: `npm run centro`. La app (`npm run dev`) le habla a través del
// proxy /api de Vite. Las ejecuciones viven aquí, no en el navegador: cerrar o recargar la página
// no las detiene ni las duplica.

function token(file: string): string {
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{64}$/.test(t)) return t;
  }
  mkdirSync(dirname(file), { recursive: true });
  const t = randomBytes(32).toString('hex');
  writeFileSync(file, t, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: permisos por ACL */
  }
  return t;
}

async function main() {
  loadEnv();
  const cfg = loadCenterConfig();
  const { lotes, errores } = loadLotes(cfg.lotes);
  const center = new Center(cfg, lotes, { runner: pipelineRunner });
  for (const e of errores) center.logs.add({ nivel: 'ERROR', componente: 'BACKEND', mensaje: `Configuración de lote inválida: ${e}` });
  const server = createCenterServer(center, token(cfg.tokenArchivo));
  server.listen(cfg.port, cfg.host, () => {
    console.log(`Centro de control en http://${cfg.host}:${cfg.port} (sólo local) · lotes: ${lotes.map((l) => l.lote).join(', ') || 'ninguno'}`);
    console.log(`Datos: ${cfg.datos}`);
    if (!process.env.CENTRO_LANZADOR) console.log('Abre la app con `npm run dev` y entra a «Centro de control» (o levanta todo junto con `npm start`).');
    center.start();
  });
  server.on('error', (e) => {
    console.error(`No se pudo abrir el puerto ${cfg.port}: ${e.message}`);
    process.exit(1);
  });
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    console.log('Deteniendo: se pide cancelar lo que corre (en un punto seguro) y se guarda el estado…');
    center.logs.add({ nivel: 'WARN', componente: 'BACKEND', mensaje: 'El servidor se está deteniendo' });
    server.close();
    await center.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
