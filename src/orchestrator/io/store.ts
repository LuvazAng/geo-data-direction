import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// Todo lo que escribe el orquestador queda dentro de <trabajo>/<lote>:
//   fuente.json          páginas y mapas encontrados
//   originales/<id>.kml  archivos tal como se descargaron (nunca se modifican)
//   estado.json          estado de cada mapa (permite reanudar)
//   ia-cache.json        respuestas de Qwen ya validadas (no se repiten consultas)
//   resultados/…         archivos generados + manifiesto.json
//   reporte.json / reporte.md

export type Estado =
  | 'PENDIENTE'
  | 'DESCARGANDO'
  | 'DESCARGADO'
  | 'ANALIZADO'
  | 'CLASIFICADO'
  | 'GENERADO'
  | 'REQUIERE_REVISION'
  /** Sin nada que generar: el usuario lo descartó (se puede deshacer). */
  | 'DESCARTADO'
  | 'ERROR';

export interface MapState {
  id: string;
  title: string;
  pageSlug: string;
  downloadUrl: string;
  estado: Estado;
  intentos: number;
  sha256?: string;
  bytes?: number;
  /** Nombre que dio el servidor (Content-Disposition). */
  nombreServidor?: string;
  descargadoEn?: string;
  archivo?: string;
  error?: string;
  actualizadoEn: string;
}

export interface BatchState {
  version: 1;
  lote: string;
  fuente: string;
  creadoEn: string;
  actualizadoEn: string;
  mapas: Record<string, MapState>;
}

export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** Nombre de archivo/carpeta seguro en Windows (sin separadores ni caracteres reservados). */
export const safeName = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- quita a propósito los caracteres de control
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'sin-nombre';

export class Workspace {
  readonly root: string;

  constructor(trabajo: string, lote: string) {
    this.root = resolve(trabajo, safeName(lote));
    mkdirSync(this.root, { recursive: true });
  }

  /** Ruta dentro del lote; rechaza cualquier intento de salir de él. */
  path(...parts: string[]): string {
    const p = resolve(this.root, ...parts);
    const rel = relative(this.root, p);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(this.root, rel) !== p) {
      throw new Error(`Ruta fuera del lote: ${parts.join('/')}`);
    }
    return p;
  }

  exists(...parts: string[]) {
    return existsSync(this.path(...parts));
  }

  /** Escritura atómica (archivo temporal + rename): un corte no deja archivos a medias. */
  write(parts: string[], data: string | Uint8Array) {
    const p = this.path(...parts);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, p);
    return p;
  }

  writeJson(parts: string[], value: unknown) {
    return this.write(parts, JSON.stringify(value, null, 2) + '\n');
  }

  read(...parts: string[]): Buffer {
    return readFileSync(this.path(...parts));
  }

  readJson<T>(parts: string[], fallback: T): T {
    if (!this.exists(...parts)) return fallback;
    return JSON.parse(this.read(...parts).toString('utf8')) as T;
  }

  loadState(fuente: string, lote: string): BatchState {
    const now = new Date().toISOString();
    const state = this.readJson<BatchState | null>(['estado.json'], null);
    if (state) {
      // un corte durante la descarga deja el mapa en DESCARGANDO: se vuelve a intentar
      for (const m of Object.values(state.mapas)) if (m.estado === 'DESCARGANDO') m.estado = 'PENDIENTE';
      return state;
    }
    return { version: 1, lote, fuente, creadoEn: now, actualizadoEn: now, mapas: {} };
  }

  saveState(state: BatchState) {
    state.actualizadoEn = new Date().toISOString();
    this.writeJson(['estado.json'], state);
  }

  /**
   * Candado del lote: sólo un proceso (CLI o centro de control) escribe a la vez en él. Si el
   * candado es de un proceso que ya no existe (corte de luz, proceso matado) se reemplaza.
   */
  lock(owner: string): () => void {
    const p = this.path('.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(p, JSON.stringify({ pid: process.pid, owner, desde: new Date().toISOString() }), { flag: 'wx' });
        let released = false;
        return () => {
          if (released) return;
          released = true;
          rmSync(p, { force: true });
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const held = this.readJson<{ pid: number; owner: string; desde: string } | null>(['.lock'], null);
        if (held && held.pid !== process.pid && pidAlive(held.pid)) {
          throw new LockError(`El lote ${this.root} está en uso por ${held.owner} (pid ${held.pid}) desde ${held.desde}`);
        }
        if (held?.pid === process.pid) throw new LockError(`El lote ${this.root} ya está en uso por este proceso (${held.owner})`);
        rmSync(p, { force: true }); // candado huérfano
      }
    }
    throw new LockError(`No se pudo tomar el candado de ${this.root}`);
  }
}

export class LockError extends Error {}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function setEstado(m: MapState, estado: Estado, extra: Partial<MapState> = {}) {
  Object.assign(m, extra, { estado, actualizadoEn: new Date().toISOString() });
  if (estado !== 'ERROR' && !('error' in extra)) delete m.error;
}
