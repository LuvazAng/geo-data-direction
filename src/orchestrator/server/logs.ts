import type { Component, Level, LogEntry } from '@protocol';
import type { EventHub } from './hub';
import type { CenterStore } from './persist';
import { sanitizeData, sanitizeText } from './sanitize';

// Registros de todos los componentes. Cada entrada se sanitiza una sola vez aquí, se guarda en
// disco, queda en memoria para la consola en vivo y sale al navegador como evento job.log.

export interface LogFilter {
  componente?: Component[];
  nivel?: Level[];
  jobId?: string;
  ruta?: string;
  lote?: string;
  q?: string;
  /** Sólo registros anteriores a esta secuencia (para paginar hacia atrás). */
  antesDe?: number;
  limite?: number;
}

const LEVELS: Level[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export class LogService {
  /** Creciente también entre reinicios del servidor (los registros viejos quedan en disco). */
  private seq = Date.now() * 10;
  private memory: LogEntry[] = [];

  constructor(
    private readonly store: CenterStore,
    private readonly hub: EventHub | null,
    private readonly maxMemory: number,
  ) {}

  add(e: Omit<LogEntry, 'seq' | 'ts'> & { ts?: string }): LogEntry {
    const entry: LogEntry = {
      seq: ++this.seq,
      ts: e.ts ?? new Date().toISOString(),
      nivel: LEVELS.includes(e.nivel) ? e.nivel : 'INFO',
      componente: e.componente,
      mensaje: sanitizeText(e.mensaje),
      ...(e.jobId && { jobId: e.jobId }),
      ...(e.lote && { lote: e.lote }),
      ...(e.ruta && { ruta: sanitizeText(e.ruta, 200) }),
      ...(e.mapa && { mapa: sanitizeText(e.mapa, 200) }),
      ...(e.duracionMs !== undefined && { duracionMs: Math.round(e.duracionMs) }),
      ...(e.datos && { datos: sanitizeData(e.datos) }),
    };
    this.memory.push(entry);
    if (this.memory.length > this.maxMemory) this.memory.splice(0, this.memory.length - this.maxMemory);
    try {
      this.store.appendLog(entry);
    } catch {
      /* el disco no debe tumbar la consola */
    }
    this.hub?.publish({ type: 'job.log', data: entry });
    return entry;
  }

  recent(limit = 300): LogEntry[] {
    return this.memory.slice(-limit);
  }

  /** Consulta: de una ejecución se lee del disco (historial completo); si no, de memoria. */
  query(f: LogFilter): LogEntry[] {
    const source = f.jobId ? this.store.readLogs(f.jobId, 10_000) : this.memory;
    const q = f.q?.toLowerCase();
    const out = source.filter(
      (e) =>
        (!f.componente?.length || f.componente.includes(e.componente)) &&
        (!f.nivel?.length || f.nivel.includes(e.nivel)) &&
        (!f.ruta || e.ruta === f.ruta) &&
        (!f.lote || e.lote === f.lote) &&
        (f.antesDe === undefined || e.seq < f.antesDe) &&
        (!q || `${e.mensaje} ${e.ruta ?? ''} ${e.componente}`.toLowerCase().includes(q)),
    );
    return out.slice(-(f.limite ?? 500));
  }
}
