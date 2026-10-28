#!/usr/bin/env node
// Levanta todo con un solo comando:  npm start
//
//   1. instala dependencias si faltan
//   2. la primera vez (con terminal interactiva) pregunta qué instalar: IA local, colonias, carpeta de datos
//   3. revisa Ollama (Qwen); si no está corriendo y está instalado, lo inicia
//   4. arranca el servidor del centro de control (127.0.0.1:5198)
//   5. arranca la app (Vite, http://localhost:5199) y abre el navegador en el centro de control
//
// Ctrl+C detiene todo: el centro pide cancelar lo que corre en un punto seguro y guarda su estado.
// Opciones:  npm start -- --sin-navegador   (no abrir el navegador)
//            npm start -- --sin-ollama      (no intentar iniciar Ollama)
//            npm start -- --configurar      (repetir las preguntas del primer arranque)
//            npm start -- --sin-asistente   (no preguntar nada)
//
// JavaScript sin dependencias a propósito: funciona incluso antes de `npm install`.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { asistente, buscarOllama, detectarEntorno, leerEstado } from './asistente.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(ROOT, '.env')); // GEODATA_DIR, CENTRO_PORT…; lo que ya está en el entorno manda
} catch {
  /* sin .env */
}
const args = new Set(process.argv.slice(2));
const CENTRO_PORT = Number(process.env.CENTRO_PORT ?? 5198);
const APP_PORT = 5199;
const isWin = process.platform === 'win32';

const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const tag = { inicio: color('36', '[inicio]'), centro: color('35', '[centro]'), app: color('32', '[app]   '), ollama: color('33', '[ollama]') };
const say = (t, ...m) => console.log(tag[t], ...m);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url, ms = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

/** Reenvía la salida de un proceso hijo con su etiqueta, línea por línea. */
function pipe(child, t) {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(tag[t], l);
    });
  }
}

// ------------------------------------------------------------------ 1. dependencias

const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(tsxCli) || !existsSync(viteCli)) {
  say('inicio', 'Faltan dependencias: npm install…');
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    say('inicio', color('31', 'npm install falló; revisa el mensaje de arriba.'));
    process.exit(1);
  }
}

// ------------------------------------------------------------------ 2. Ollama / Qwen

function iaConfig() {
  // la del primer lote (todos usan el mismo runtime local)
  try {
    const dir = join(ROOT, 'config', 'lotes');
    const file = ['sur.json', 'oriente.json'].map((f) => join(dir, f)).find(existsSync);
    const ia = file ? (JSON.parse(readFileSync(file, 'utf8')).ia ?? {}) : {};
    return { url: process.env.OLLAMA_URL ?? ia.url ?? 'http://127.0.0.1:11434', modelo: ia.modelo ?? 'qwen3.5:4b' };
  } catch {
    return { url: 'http://127.0.0.1:11434', modelo: 'qwen3.5:4b' };
  }
}

let ollamaChild = null;
const ia = iaConfig();
async function ensureOllama() {
  if (await probe(`${ia.url}/api/version`)) return checkModel();
  if (args.has('--sin-ollama')) {
    say('ollama', 'No está corriendo (--sin-ollama): el centro funciona, pero sin Qwen.');
    return;
  }
  const exe = buscarOllama();
  if (!exe) {
    say('ollama', color('33', 'No está corriendo y no se encontró instalado: el centro funciona sin Qwen (sólo reglas).'));
    return;
  }
  say('ollama', `No estaba corriendo; iniciando ${exe} serve…`);
  ollamaChild = spawn(exe, ['serve'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  ollamaChild.on('error', (e) => say('ollama', color('31', `no se pudo iniciar: ${e.message}`)));
  // Ollama escribe mucho por stderr: sólo se muestran errores
  ollamaChild.stderr.on('data', (d) => /error|panic/i.test(String(d)) && say('ollama', String(d).trim().slice(0, 300)));
  for (let i = 0; i < 30; i++) {
    if (await probe(`${ia.url}/api/version`)) return checkModel();
    await wait(500);
  }
  say('ollama', color('33', 'No respondió en 15 s: el centro sigue, sin Qwen.'));
}

async function checkModel() {
  const r = await probe(`${ia.url}/api/tags`);
  const names = r ? (JSON.parse(r.body).models ?? []).map((m) => m.name) : [];
  if (names.includes(ia.modelo)) say('ollama', `Listo: ${ia.modelo} disponible en ${ia.url}`);
  // no se descarga ningún modelo sin que lo pidas
  else say('ollama', color('33', `Ollama responde, pero no tiene ${ia.modelo}. Para descargarlo: ollama pull ${ia.modelo} (el centro funciona sin él).`));
}

// ------------------------------------------------------------------ 2b. asistente de primer arranque

/** Corre un comando mostrando su salida (instaladores, descarga del modelo) y devuelve su código de salida. */
const run = (cmd, cmdArgs) =>
  new Promise((done) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', (e) => {
      say('inicio', color('31', `no se pudo ejecutar ${cmd}: ${e.message}`));
      done(127);
    });
    child.on('exit', (code) => done(code ?? 1));
  });

async function correrAsistente() {
  const estadoArchivo = join(ROOT, '.centro', 'asistente.json');
  const interactivo = !!(process.stdin.isTTY && process.stdout.isTTY);
  const primera = !leerEstado(estadoArchivo);
  const rl = interactivo && !args.has('--sin-asistente') ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  rl?.on('SIGINT', () => process.exit(130));
  // las líneas se guardan aunque lleguen antes de la pregunta (entrada pegada o redirigida); sin más entrada = respuesta vacía
  const lineas = rl?.[Symbol.asyncIterator]();
  const ask = async (pregunta) => {
    rl.setPrompt(pregunta);
    rl.prompt();
    const r = await lineas.next();
    return r.done ? '' : r.value;
  };
  try {
    const motivo = await asistente({
      opciones: { interactivo, sinAsistente: args.has('--sin-asistente'), configurar: args.has('--configurar') },
      entorno: detectarEntorno({ root: ROOT, modelo: ia.modelo }),
      estadoArchivo,
      ask,
      log: (m) => console.log(m),
      io: {
        env: process.env,
        envArchivo: join(ROOT, '.env'),
        log: (m) => say('inicio', m),
        run,
        ollama: () => buscarOllama(),
        ollamaListo: async () => {
          await ensureOllama();
          return !!(await probe(`${ia.url}/api/version`));
        },
        colonias: () => run(process.execPath, [tsxCli, 'src/orchestrator/cli/colonias-cli.ts']),
      },
    });
    if (motivo === 'sin-terminal' && primera && !args.has('--sin-asistente')) {
      say('inicio', 'Primer arranque sin terminal interactiva: no se pregunta ni se instala nada. Para configurar: npm start -- --configurar');
    }
  } finally {
    rl?.close();
  }
}

// ------------------------------------------------------------------ 3 y 4. centro y app

const children = [];
let stopping = false;

async function startCentro() {
  const existing = await probe(`http://127.0.0.1:${CENTRO_PORT}/api/salud`);
  if (existing && (existing.status === 401 || existing.status === 200)) {
    say('centro', `Ya estaba corriendo en 127.0.0.1:${CENTRO_PORT}: se usa ése.`);
    return;
  }
  if (existing) {
    say('centro', color('31', `El puerto ${CENTRO_PORT} lo usa otro programa. Cámbialo con CENTRO_PORT=… npm start`));
    process.exit(1);
  }
  const child = spawn(process.execPath, [tsxCli, 'src/orchestrator/server/index.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', CENTRO_LANZADOR: '1' },
  });
  children.push({ name: 'centro', child });
  pipe(child, 'centro');
  child.on('exit', (code) => onExit('centro', code));
  for (let i = 0; i < 60; i++) {
    const r = await probe(`http://127.0.0.1:${CENTRO_PORT}/api/salud`);
    if (r && (r.status === 401 || r.status === 200)) return;
    if (child.exitCode !== null) return;
    await wait(500);
  }
  say('centro', color('33', 'Tarda en responder; la app reintenta sola la conexión.'));
}

function openBrowser(url) {
  if (args.has('--sin-navegador')) return;
  const [cmd, a] = isWin ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, a, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

async function startApp() {
  const used = await probe(`http://localhost:${APP_PORT}/`);
  if (used) {
    // ¿Es esta misma app (con su proxy al centro) u otro programa?
    const api = await probe(`http://localhost:${APP_PORT}/api/salud`);
    if (api && api.status === 200 && children.length === 0) {
      say('inicio', color('1', `Ya estaba todo corriendo: http://localhost:${APP_PORT}/#centro`));
      openBrowser(`http://localhost:${APP_PORT}/#centro`);
      process.exit(0);
    }
    say('app', color('31', `El puerto ${APP_PORT} lo usa otro programa (¿otra ventana con npm run dev?). Ciérrala y vuelve a intentar.`));
    return stopAll(1);
  }
  const viteArgs = [viteCli, '--port', String(APP_PORT), '--strictPort'];
  if (!args.has('--sin-navegador')) viteArgs.push('--open', '/#centro');
  const child = spawn(process.execPath, viteArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push({ name: 'app', child });
  pipe(child, 'app');
  child.on('exit', (code) => onExit('app', code));
  for (let i = 0; i < 60 && !(await probe(`http://localhost:${APP_PORT}/`)); i++) await wait(250);
}

function onExit(name, code) {
  if (stopping) return;
  say('inicio', color('31', `${name} terminó (código ${code}). Se detiene todo.`));
  void stopAll(code ?? 1);
}

async function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  say('inicio', 'Deteniendo… (el centro guarda su estado; lo que corría queda para reintentar)');
  const alive = () => children.filter((c) => c.child.exitCode === null && c.child.signalCode === null);
  // En Windows, Ctrl+C ya llegó a los procesos de la misma consola; se les da tiempo de cerrar solos
  for (let i = 0; i < 40 && alive().length; i++) await wait(200);
  for (const c of alive()) c.child.kill(isWin ? undefined : 'SIGINT');
  for (let i = 0; i < 25 && alive().length; i++) await wait(200);
  for (const c of alive()) c.child.kill('SIGKILL');
  if (ollamaChild && ollamaChild.exitCode === null) ollamaChild.kill();
  process.exit(code);
}

process.on('SIGINT', () => void stopAll(0));
process.on('SIGTERM', () => void stopAll(0));

say('inicio', 'Rutas Morelos — editor de trayectos + centro de control');
await correrAsistente();
await ensureOllama();
await startCentro();
await startApp();
say('inicio', color('1', `Listo: http://localhost:${APP_PORT}/#centro  ·  Ctrl+C para detener todo`));
