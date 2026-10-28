import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, type LoteInfo } from '../config';
import { dataDirs, PROJECT_DIR } from '../paths';

// Configuración del centro de control. Todo tiene un valor por omisión; se puede cambiar en
// config/lotes/centro.json o con variables de entorno (CENTRO_*, PI_*).

export const CONFIG_DIR = resolve(PROJECT_DIR, 'config', 'lotes');

export interface CenterConfig {
  host: string;
  port: number;
  /** Archivos de configuración de lote que el centro puede usar (los únicos autorizados). */
  lotes: string[];
  /** Carpeta de datos del centro: ejecuciones, registros, chat. */
  datos: string;
  /** Archivo con el token local que el proxy de Vite agrega a cada petición. */
  tokenArchivo: string;
  /** Orígenes del navegador aceptados (la app de Vite). */
  origenes: string[];
  /** Ejecuciones simultáneas en total (cada lote, además, de una en una). */
  maxSimultaneas: number;
  /** Al arrancar, seguir con la cola si no estaba en pausa. */
  autoIniciar: boolean;
  retencion: {
    /** Ejecuciones terminadas que se conservan (con sus registros). */
    ejecuciones: number;
    /** Registros guardados por ejecución. */
    logsPorEjecucion: number;
    /** Registros en memoria para la consola en vivo. */
    logsMemoria: number;
    /** Eventos que se pueden reenviar a un navegador que se reconecta. */
    eventos: number;
    /** Mensajes del chat que se conservan. */
    chat: number;
  };
  pi: {
    habilitado: boolean;
    /** node.exe con el que corre Pi (el instalador de Pi trae el suyo). */
    node: string;
    launcher: string;
    timeoutMs: number;
  };
}

type Partial2<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? Partial<T[K]> : T[K] };

function defaultLotes(): string[] {
  if (!existsSync(CONFIG_DIR)) return [];
  return readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'centro.json')
    .map((f) => join(CONFIG_DIR, f))
    .sort();
}

function defaultPiNode(): string {
  const local = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pi-node', 'current', 'node.exe') : '';
  return local && existsSync(local) ? local : process.execPath;
}

export function loadCenterConfig(env: NodeJS.ProcessEnv = process.env, file = join(CONFIG_DIR, 'centro.json')): CenterConfig {
  const raw: Partial2<CenterConfig> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const lotes = (raw.lotes?.length ? raw.lotes.map((p) => resolve(CONFIG_DIR, p)) : defaultLotes()).filter((p) => existsSync(p));
  const firstWork = lotes.length ? loadConfig(lotes[0], env).dirs.trabajo : dataDirs(env).trabajo;
  const cfg: CenterConfig = {
    host: '127.0.0.1',
    port: Number(env.CENTRO_PORT ?? raw.port ?? 5198),
    lotes,
    datos: resolve(env.CENTRO_DATOS ?? (raw.datos ? resolve(CONFIG_DIR, raw.datos) : join(firstWork, '_centro'))),
    tokenArchivo: resolve(env.CENTRO_TOKEN_ARCHIVO ?? join(PROJECT_DIR, '.centro', 'token')),
    origenes: raw.origenes ?? ['http://localhost:5199', 'http://127.0.0.1:5199'],
    maxSimultaneas: Math.max(1, Math.min(4, Number(env.CENTRO_MAX_SIMULTANEAS ?? raw.maxSimultaneas ?? 1))),
    autoIniciar: raw.autoIniciar ?? true,
    retencion: {
      ejecuciones: 200,
      logsPorEjecucion: 5000,
      logsMemoria: 3000,
      eventos: 3000,
      chat: 500,
      ...raw.retencion,
    },
    pi: {
      habilitado: raw.pi?.habilitado ?? true,
      node: env.PI_NODE ?? raw.pi?.node ?? defaultPiNode(),
      launcher: env.PI_LAUNCHER ?? raw.pi?.launcher ?? join(homedir(), '.pi', 'agent', 'bin', 'pi-launcher.js'),
      timeoutMs: raw.pi?.timeoutMs ?? 240_000,
    },
  };
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) throw new Error(`Puerto inválido: ${cfg.port}`);
  return cfg;
}

/** Lee los lotes autorizados (los archivos de configuración inválidos se informan y se omiten). */
export function loadLotes(files: string[]): { lotes: LoteInfo[]; errores: string[] } {
  const lotes: LoteInfo[] = [];
  const errores: string[] = [];
  for (const archivo of files) {
    try {
      const config = loadConfig(archivo);
      if (lotes.some((l) => l.lote === config.lote)) throw new Error(`lote repetido: ${config.lote}`);
      lotes.push({ lote: config.lote, zona: config.zona, fuente: config.fuente.url, archivo, raiz: resolve(config.dirs.trabajo, config.lote), config });
    } catch (e) {
      errores.push(`${archivo}: ${(e as Error).message}`);
    }
  }
  return { lotes, errores };
}
