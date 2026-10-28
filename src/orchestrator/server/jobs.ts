import { randomUUID } from 'node:crypto';
import {
  type PipelineEvent,
  type Stage,
  ACTIVE,
  FINISHED,
  STATUS_OF_STAGE,
  type Job,
  type JobFile,
  type JobParams,
  type JobUnit,
  type QueueState,
} from '@protocol';
import type { RunSummary } from '../pipeline/pipeline';
import { ActionError } from '../errors';
import type { LoteInfo } from '../config';
import type { EventHub } from './hub';
import type { LogService } from './logs';
import type { CenterStore } from './persist';

// Cola y ejecuciones del centro de control.
//
// Qué significa cada control (el orquestador no se puede congelar a mitad de una etapa):
//  - Pausar la cola: no se toman ejecuciones nuevas; la que está corriendo termina normalmente.
//    "Ejecutar siguiente" o "Iniciar" siguen funcionando con la cola en pausa (modo manual).
//  - Cancelar una pendiente: sale de la cola, inmediato.
//  - Cancelar una en curso: se pide al orquestador, que se detiene en el siguiente punto seguro
//    (entre etapas, entre mapas descargados o entre consultas a Qwen; una descarga o consulta ya
//    iniciada termina primero). En la etapa de salida no se acepta: está escribiendo archivos.
//  - Reintentar: crea una ejecución nueva desde el principio (los originales ya descargados no se
//    vuelven a bajar y los resultados iguales no se reescriben). No es una reanudación.
//  - Si el servidor se detiene con una ejecución corriendo, al arrancar queda INTERRUMPIDO.

export interface RunnerContext {
  signal: AbortSignal;
  emit: (e: PipelineEvent) => void;
  lote: LoteInfo;
}

export type JobRunner = (job: Job, ctx: RunnerContext) => Promise<RunSummary & { reporte: string; tiempos: Partial<Record<Stage, number>> }>;

const NO_CANCEL: Stage[] = ['salida', 'reporte'];

export class JobManager {
  private jobs = new Map<string, Job>();
  private queue: { orden: string[]; pausada: boolean };
  private running = new Map<string, AbortController>();
  private lastProgress = new Map<string, number>();
  private saveTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly deps: {
      store: CenterStore;
      hub: EventHub;
      logs: LogService;
      runner: JobRunner;
      lotes: LoteInfo[];
      maxSimultaneas: number;
      onRoutesChanged?: (lote: string) => void;
    },
  ) {
    for (const j of deps.store.loadJobs()) this.jobs.set(j.id, j);
    this.queue = deps.store.loadQueue();
    this.recover();
  }

  // ------------------------------------------------------------------ consultas

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }

  get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new ActionError(`No existe la ejecución ${id}`, 404);
    return j;
  }

  queueState(): QueueState {
    return { orden: [...this.queue.orden], pausada: this.queue.pausada, maxSimultaneas: this.deps.maxSimultaneas };
  }

  runningJobs(): Job[] {
    return [...this.running.keys()].map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  lote(name: string): LoteInfo {
    const l = this.deps.lotes.find((x) => x.lote === name);
    if (!l) throw new ActionError(`Lote no autorizado: ${name}`, 400);
    return l;
  }

  // ------------------------------------------------------------------ acciones

  /**
   * Agrega una ejecución. Si ya hay una pendiente o en curso para la misma unidad, o una con la
   * misma clave de idempotencia, devuelve esa (no se duplica).
   */
  enqueue(
    loteName: string,
    unidad: JobUnit,
    opts: { parametros?: Partial<JobParams>; primero?: boolean; iniciar?: boolean; clave?: string; origen?: Job['origen']; reintentoDe?: Job } = {},
  ): { job: Job; creado: boolean } {
    const lote = this.lote(loteName);
    if (opts.clave) {
      const same = [...this.jobs.values()].find((j) => j.claveIdempotencia === opts.clave);
      if (same) return { job: same, creado: false };
    }
    const sameUnit = (j: Job) =>
      j.lote === lote.lote &&
      JSON.stringify(j.unidad.tipo === 'ruta' ? ['ruta', j.unidad.slug] : ['fuente']) ===
        JSON.stringify(unidad.tipo === 'ruta' ? ['ruta', unidad.slug] : ['fuente']);
    const existing = [...this.jobs.values()].find((j) => sameUnit(j) && (j.estado === 'PENDIENTE' || ACTIVE.includes(j.estado)));
    if (existing) {
      if (opts.primero && existing.estado === 'PENDIENTE') this.moveFirst(existing.id);
      if (opts.iniciar && existing.estado === 'PENDIENTE') this.start(existing.id);
      return { job: existing, creado: false };
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: `j${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      lote: lote.lote,
      unidad,
      estado: 'PENDIENTE',
      etapa: null,
      parametros: { sinRed: false, refrescar: false, sinIa: false, ...opts.parametros },
      creadoEn: now,
      encoladoEn: now,
      tiempos: {},
      intento: (opts.reintentoDe?.intento ?? 0) + 1,
      ...(opts.reintentoDe && { reintentoDe: opts.reintentoDe.id }),
      archivosEntrada: [],
      archivosSalida: [],
      errores: [],
      advertencias: [],
      ...(opts.clave && { claveIdempotencia: opts.clave }),
      origen: opts.origen ?? 'api',
    };
    this.jobs.set(job.id, job);
    if (opts.primero) this.queue.orden.unshift(job.id);
    else this.queue.orden.push(job.id);
    this.persist();
    this.deps.hub.publish({ type: 'job.created', data: job });
    this.deps.hub.publish({ type: 'job.queued', data: job });
    this.publishQueue();
    this.log(job, 'INFO', `En cola: ${describe(job)}${opts.primero ? ' (al frente)' : ''}${job.reintentoDe ? ` — reintento de ${job.reintentoDe}` : ''}`);
    this.deps.onRoutesChanged?.(job.lote);
    if (opts.iniciar) this.start(job.id);
    else this.pump();
    return { job, creado: true };
  }

  moveFirst(id: string) {
    const j = this.get(id);
    if (j.estado !== 'PENDIENTE') throw new ActionError(`La ejecución ${id} no está pendiente (${j.estado})`);
    this.queue.orden = [id, ...this.queue.orden.filter((x) => x !== id)];
    this.persist();
    this.publishQueue();
    this.log(j, 'INFO', `Pasa al frente de la cola: ${describe(j)}`);
  }

  /** Nuevo orden de los pendientes: debe incluir exactamente los mismos ids. */
  reorder(ids: string[]) {
    const current = new Set(this.queue.orden);
    if (!Array.isArray(ids) || ids.length !== current.size || ids.some((id) => !current.has(id)) || new Set(ids).size !== ids.length) {
      throw new ActionError('El nuevo orden debe tener exactamente las ejecuciones pendientes (la cola cambió: vuelve a cargarla)', 409);
    }
    this.queue.orden = [...ids];
    this.persist();
    this.publishQueue();
    this.deps.logs.add({ nivel: 'INFO', componente: 'BACKEND', mensaje: 'Cola reordenada' });
  }

  /** Inicia ya una ejecución pendiente; si no hay capacidad, la pasa al frente. */
  start(id: string): 'iniciada' | 'al-frente' {
    const j = this.get(id);
    if (j.estado !== 'PENDIENTE') throw new ActionError(`La ejecución ${id} no está pendiente (${j.estado})`);
    if (this.canStart(j)) {
      this.launch(j);
      return 'iniciada';
    }
    this.moveFirst(id);
    return 'al-frente';
  }

  /** Ejecuta la siguiente pendiente (aunque la cola esté en pausa). */
  runNext(): Job | null {
    const next = this.queue.orden.map((id) => this.jobs.get(id)!).find((j) => j && this.canStart(j));
    if (!next) {
      if (this.queue.orden.length && this.running.size) throw new ActionError('Ya hay una ejecución en curso; la siguiente empezará al terminar');
      return null;
    }
    this.launch(next);
    return next;
  }

  pause() {
    this.queue.pausada = true;
    this.persist();
    this.publishQueue();
    this.deps.logs.add({
      nivel: 'INFO',
      componente: 'BACKEND',
      mensaje: `Cola en pausa${this.running.size ? ': la ejecución en curso terminará normalmente' : ''}`,
    });
  }

  resume() {
    this.queue.pausada = false;
    this.persist();
    this.publishQueue();
    this.deps.logs.add({ nivel: 'INFO', componente: 'BACKEND', mensaje: 'Cola reanudada' });
    this.pump();
  }

  cancel(id: string): 'cancelada' | 'solicitada' {
    const j = this.get(id);
    if (j.estado === 'PENDIENTE') {
      this.queue.orden = this.queue.orden.filter((x) => x !== id);
      this.finish(j, 'CANCELADO', 'Cancelada antes de empezar');
      return 'cancelada';
    }
    if (!ACTIVE.includes(j.estado)) throw new ActionError(`La ejecución ${id} ya terminó (${j.estado})`);
    if (j.etapa && NO_CANCEL.includes(j.etapa)) {
      throw new ActionError('Está escribiendo los resultados: no es seguro cancelar ahora; terminará en unos segundos');
    }
    j.cancelacionSolicitada = true;
    this.running.get(id)?.abort();
    this.persist();
    this.deps.hub.publish({ type: 'job.stage_changed', data: j });
    this.log(j, 'WARN', `Cancelación solicitada en la etapa «${j.etapa}»: se detendrá en el siguiente punto seguro`);
    return 'solicitada';
  }

  retry(id: string): Job {
    const j = this.get(id);
    if (!FINISHED.includes(j.estado)) throw new ActionError(`La ejecución ${id} sigue ${j.estado === 'PENDIENTE' ? 'pendiente' : 'en curso'}`);
    if (j.estado === 'COMPLETADO') throw new ActionError('Terminó sin errores; si quieres volver a procesar la ruta, encólala de nuevo');
    const { job } = this.enqueue(j.lote, j.unidad, { parametros: j.parametros, primero: true, origen: j.origen, reintentoDe: j });
    return job;
  }

  /** Al detener el servidor: no se toman más ejecuciones y se piden cancelar las que corren. */
  async shutdown(waitMs = 5000) {
    this.stopped = true;
    for (const [id, ctrl] of this.running) {
      const j = this.jobs.get(id)!;
      if (!j.etapa || !NO_CANCEL.includes(j.etapa)) ctrl.abort();
    }
    const t0 = Date.now();
    while (this.running.size && Date.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 100));
    this.flush();
  }

  // ------------------------------------------------------------------ ejecución

  private canStart(j: Job) {
    if (this.stopped || j.estado !== 'PENDIENTE') return false;
    if (this.running.size >= this.deps.maxSimultaneas) return false;
    // un lote, una ejecución a la vez: comparten estado, originales y resultados
    return ![...this.running.keys()].some((id) => this.jobs.get(id)?.lote === j.lote);
  }

  /** Toma las siguientes ejecuciones si la cola no está en pausa y hay capacidad. */
  pump() {
    if (this.queue.pausada || this.stopped) return;
    // sobre una copia: iniciar una ejecución cambia la cola
    for (const id of this.queue.orden.slice()) {
      const j = this.jobs.get(id);
      if (j && this.canStart(j)) this.launch(j);
    }
  }

  private launch(j: Job) {
    const lote = this.lote(j.lote);
    const ctrl = new AbortController();
    this.running.set(j.id, ctrl);
    this.queue.orden = this.queue.orden.filter((x) => x !== j.id);
    j.estado = 'EN_DESCARGA';
    j.etapa = null;
    j.iniciadoEn = new Date().toISOString();
    this.persist();
    this.deps.hub.publish({ type: 'job.started', data: j });
    this.publishQueue();
    this.log(j, 'INFO', `Inicia: ${describe(j)}${j.parametros.sinRed ? ' · sin red' : ''}${j.parametros.sinIa ? ' · sin IA' : ''}`);

    const emit = (e: PipelineEvent) => this.onEvent(j, e);
    void this.deps
      .runner(j, { signal: ctrl.signal, emit, lote })
      .then((r) => {
        j.resultado = { mapas: r.mapas, mapasConError: r.mapasConError, trazos: r.trazos, generados: r.generados, revision: r.revision, reporte: r.reporte };
        j.tiempos = { ...j.tiempos, ...r.tiempos };
        j.errores.push(...r.errores);
        j.advertencias.push(...r.advertencias, ...r.conflictos.map((c) => `${c.rel}: ${c.motivo}`));
        mergeFiles(
          j,
          r.archivos.map((a) => ({ rel: a.rel, tipo: a.tipo, estado: a.estado })),
        );
        const warn = r.revision > 0 || r.mapasConError > 0 || j.advertencias.length > 0 || j.errores.length > 0;
        this.finish(
          j,
          warn ? 'COMPLETADO_CON_ADVERTENCIAS' : 'COMPLETADO',
          `Terminó: ${r.generados} generado(s), ${r.revision} en revisión, ${r.mapasConError} mapa(s) con error`,
        );
      })
      .catch((e: unknown) => {
        const aborted = ctrl.signal.aborted || (e as Error)?.name === 'AbortError';
        if (aborted && this.stopped && !j.cancelacionSolicitada) {
          this.finish(j, 'INTERRUMPIDO', `Interrumpida al detener el servidor en la etapa «${j.etapa}»; se puede reintentar`);
        } else if (aborted) {
          this.finish(
            j,
            'CANCELADO',
            `Cancelada en la etapa «${j.etapa}». Los originales ya descargados se conservan; los resultados de esta ruta no se escribieron`,
          );
        } else {
          j.errores.push((e as Error)?.message ?? String(e));
          this.finish(j, 'FALLIDO', `Falló en la etapa «${j.etapa}»: ${(e as Error)?.message ?? e}`);
        }
      })
      .finally(() => {
        this.running.delete(j.id);
        this.lastProgress.delete(j.id);
        this.pump();
      });
  }

  private onEvent(j: Job, e: PipelineEvent) {
    if (e.tipo === 'log') {
      this.deps.logs.add({
        nivel: e.nivel,
        componente: e.componente,
        mensaje: e.mensaje,
        jobId: j.id,
        lote: j.lote,
        ruta: e.ruta,
        mapa: e.mapa,
        duracionMs: e.duracionMs,
        datos: e.datos,
      });
      return;
    }
    if (e.tipo === 'etapa') {
      if (j.etapa === e.etapa) return;
      j.etapa = e.etapa;
      j.estado = STATUS_OF_STAGE[e.etapa];
      if (e.etapa !== 'descarga') delete j.progreso;
      this.persistSoon();
      this.deps.hub.publish({ type: 'job.stage_changed', data: j });
      return;
    }
    if (e.tipo === 'progreso') {
      if (e.total <= 0) return;
      j.progreso = { etapa: e.etapa, hechos: e.hechos, total: e.total };
      const last = this.lastProgress.get(j.id) ?? 0;
      if (Date.now() - last > 250 || e.hechos === e.total) {
        this.lastProgress.set(j.id, Date.now());
        this.deps.hub.publish({ type: 'job.progress', data: j });
      }
      return;
    }
    // archivo
    if (e.rel?.startsWith('originales/') && !j.archivosEntrada.includes(e.rel)) j.archivosEntrada.push(e.rel);
    if (e.rel?.startsWith('resultados/')) mergeFiles(j, [{ rel: e.rel, tipo: e.estado === 'revision' ? 'revision' : 'resultado', estado: e.estado }]);
    const data = { jobId: j.id, lote: j.lote, ruta: e.ruta, mapa: e.mapa, rel: e.rel, estado: e.estado, detalle: e.detalle };
    this.deps.hub.publish({ type: e.estado === 'detectado' || e.estado === 'descargando' ? 'job.file_detected' : 'job.file_updated', data });
    this.persistSoon();
  }

  private finish(j: Job, estado: Job['estado'], mensaje: string) {
    j.estado = estado;
    j.finalizadoEn = new Date().toISOString();
    delete j.progreso;
    this.persist();
    const type = estado === 'FALLIDO' || estado === 'INTERRUMPIDO' ? 'job.failed' : estado === 'CANCELADO' ? 'job.cancelled' : 'job.completed';
    this.deps.hub.publish({ type, data: j });
    this.publishQueue();
    this.log(j, estado === 'FALLIDO' || estado === 'INTERRUMPIDO' ? 'ERROR' : estado === 'COMPLETADO' ? 'INFO' : 'WARN', mensaje);
    this.deps.onRoutesChanged?.(j.lote);
  }

  /** Al arrancar: lo que estaba corriendo no se puede reanudar a mitad de etapa. */
  private recover() {
    let changed = false;
    for (const j of this.jobs.values()) {
      if (ACTIVE.includes(j.estado)) {
        j.estado = 'INTERRUMPIDO';
        j.finalizadoEn = new Date().toISOString();
        j.errores.push(
          `El servidor se detuvo durante la etapa «${j.etapa}». No se reanuda sola: reinténtala (empieza de nuevo, sin volver a descargar lo que ya está).`,
        );
        changed = true;
        this.log(j, 'ERROR', `Interrumpida por un reinicio del servidor (etapa «${j.etapa}»)`);
      }
    }
    // la cola sólo puede tener pendientes que existan
    const before = this.queue.orden.length;
    this.queue.orden = this.queue.orden.filter((id) => this.jobs.get(id)?.estado === 'PENDIENTE');
    for (const j of this.jobs.values()) if (j.estado === 'PENDIENTE' && !this.queue.orden.includes(j.id)) this.queue.orden.push(j.id);
    if (changed || before !== this.queue.orden.length) this.persist();
  }

  // ------------------------------------------------------------------ persistencia

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const kept = this.deps.store.prune([...this.jobs.values()], (j) => FINISHED.includes(j.estado));
    if (kept.length !== this.jobs.size) this.jobs = new Map(kept.map((j) => [j.id, j]));
    this.deps.store.saveJobs([...this.jobs.values()]);
    this.deps.store.saveQueue(this.queue);
  }

  private persistSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.persist(), 1000);
    this.saveTimer.unref();
  }

  flush() {
    this.persist();
  }

  private publishQueue() {
    this.deps.hub.publish({ type: 'queue.updated', data: this.queueState() });
  }

  private log(j: Job, nivel: 'INFO' | 'WARN' | 'ERROR', mensaje: string) {
    this.deps.logs.add({ nivel, componente: 'BACKEND', mensaje, jobId: j.id, lote: j.lote, ruta: j.unidad.tipo === 'ruta' ? j.unidad.slug : undefined });
  }
}

export const describe = (j: Job) => (j.unidad.tipo === 'ruta' ? `${j.lote} · ${j.unidad.titulo || j.unidad.slug}` : `${j.lote} · actualizar fuente`);

function mergeFiles(j: Job, files: JobFile[]) {
  for (const f of files) {
    const i = j.archivosSalida.findIndex((x) => x.rel === f.rel);
    if (i >= 0) j.archivosSalida[i] = f;
    else j.archivosSalida.push(f);
  }
}
