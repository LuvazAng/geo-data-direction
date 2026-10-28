import { useEffect, useState } from 'react';
import { STAGES, type Job, type JobStatus, type RouteStatus } from '@protocol';

export const STATUS_LABEL: Record<JobStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_DESCARGA: 'En descarga',
  EN_ANALISIS: 'En análisis',
  EN_CLASIFICACION: 'En clasificación',
  EN_GENERACION: 'Generando archivos',
  COMPLETADO: 'Completado',
  COMPLETADO_CON_ADVERTENCIAS: 'Completado con advertencias',
  FALLIDO: 'Fallido',
  CANCELADO: 'Cancelado',
  INTERRUMPIDO: 'Interrumpido',
};

export const ROUTE_LABEL: Record<RouteStatus, string> = {
  'sin-procesar': 'Sin procesar',
  incompleta: 'A medias',
  'con-errores': 'Con errores',
  'con-revision': 'Esperando revisión',
  procesada: 'Procesada',
};

export const STAGE_LABEL: Record<string, string> = {
  fuente: 'Fuente',
  descarga: 'Descarga',
  analisis: 'Análisis',
  clasificacion: 'Clasificación',
  comparacion: 'Comparación',
  ia: 'Qwen',
  nombres: 'Nombres',
  salida: 'Archivos',
  reporte: 'Reporte',
};

export type Tone = 'ok' | 'warn' | 'err' | 'run' | 'idle';

export function jobTone(j: Job): Tone {
  if (j.estado.startsWith('EN_')) return 'run';
  if (j.estado === 'COMPLETADO') return j.resultado?.revision ? 'warn' : 'ok';
  if (j.estado === 'COMPLETADO_CON_ADVERTENCIAS') return 'warn';
  if (j.estado === 'FALLIDO' || j.estado === 'INTERRUMPIDO') return 'err';
  return 'idle';
}

export const routeTone = (s: RouteStatus): Tone =>
  s === 'procesada' ? 'ok' : s === 'con-revision' ? 'warn' : s === 'con-errores' ? 'err' : s === 'incompleta' ? 'run' : 'idle';

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`cc-badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function JobBadge({ job }: { job: Job }) {
  const waiting = (job.estado === 'COMPLETADO' || job.estado === 'COMPLETADO_CON_ADVERTENCIAS') && (job.resultado?.revision ?? 0) > 0;
  return (
    <Badge tone={jobTone(job)} title={job.cancelacionSolicitada ? 'Cancelación solicitada' : undefined}>
      {job.estado.startsWith('EN_') && <span className="cc-spinner" aria-hidden />}
      {waiting ? 'Esperando revisión' : STATUS_LABEL[job.estado]}
      {job.cancelacionSolicitada && job.estado.startsWith('EN_') ? ' · cancelando' : ''}
    </Badge>
  );
}

export const jobTitle = (j: Job) => (j.unidad.tipo === 'ruta' ? j.unidad.titulo || j.unidad.slug : 'Actualizar fuente');

export const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { hour12: false }) : '—');
export const dateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('es-MX', { hour12: false, dateStyle: 'short', timeStyle: 'medium' }) : '—';

export function duration(ms?: number | null) {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export const jobDuration = (j: Job, now = Date.now()) => (j.iniciadoEn ? (j.finalizadoEn ? Date.parse(j.finalizadoEn) : now) - Date.parse(j.iniciadoEn) : null);

/** Refresca cada `ms` (para relojes de "hace cuánto"). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Etapas del orquestador. Sólo la descarga muestra avance (mapas descargados de N, que se puede
 * contar de verdad); el resto muestra en qué etapa va, sin porcentajes inventados.
 */
export function StageBar({ job }: { job: Job }) {
  const current = job.etapa ? STAGES.indexOf(job.etapa) : -1;
  const done = !job.estado.startsWith('EN_') && job.estado !== 'PENDIENTE';
  const stages = job.unidad.tipo === 'fuente' ? STAGES.slice(0, 1) : STAGES;
  return (
    <div className="cc-stages" aria-label="Etapas">
      {stages.map((s, i) => {
        const state = done && job.estado.startsWith('COMPLETADO') ? 'done' : i < current ? 'done' : i === current ? (done ? 'stopped' : 'now') : 'todo';
        const ms = job.tiempos[s];
        return (
          <div key={s} className={`cc-stage ${state}`} title={ms !== undefined ? `${STAGE_LABEL[s]}: ${duration(ms)}` : STAGE_LABEL[s]}>
            <span>{STAGE_LABEL[s]}</span>
            {state === 'now' && s === 'descarga' && job.progreso?.etapa === 'descarga' && (
              <small>
                {job.progreso.hechos}/{job.progreso.total}
              </small>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function JobCard({
  job,
  onOpen,
  onCancel,
  onRetry,
  disabled,
  compact,
}: {
  job: Job;
  onOpen: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const now = useNow(job.estado.startsWith('EN_') ? 1000 : 60_000);
  const active = job.estado.startsWith('EN_');
  const canCancel = (active && !['salida', 'reporte'].includes(job.etapa ?? '') && !job.cancelacionSolicitada) || job.estado === 'PENDIENTE';
  const canRetry = ['FALLIDO', 'CANCELADO', 'INTERRUMPIDO', 'COMPLETADO_CON_ADVERTENCIAS'].includes(job.estado);
  return (
    <div className={`cc-job ${jobTone(job)}`}>
      <div className="cc-job-head">
        <button className="link" onClick={() => onOpen(job.id)} title="Ver detalles">
          <b>{jobTitle(job)}</b> <span className="muted small">{job.lote}</span>
        </button>
        <JobBadge job={job} />
      </div>
      {!compact && active && <StageBar job={job} />}
      <div className="small muted">
        {job.id} ·{' '}
        {job.estado === 'PENDIENTE' ? `en cola desde ${time(job.encoladoEn)}` : `inició ${time(job.iniciadoEn)} · ${duration(jobDuration(job, now))}`}
        {job.resultado &&
          ` · ${job.resultado.generados} generados · ${job.resultado.revision} en revisión${job.resultado.mapasConError ? ` · ${job.resultado.mapasConError} mapas con error` : ''}`}
        {job.intento > 1 && ` · intento ${job.intento}`}
      </div>
      {job.errores.length > 0 && !active && <div className="small cc-err-text">{job.errores[job.errores.length - 1]}</div>}
      {(onCancel || onRetry) && (
        <div className="row">
          {onCancel && canCancel && (
            <button onClick={() => onCancel(job.id)} disabled={disabled}>
              Cancelar
            </button>
          )}
          {onRetry && canRetry && (
            <button onClick={() => onRetry(job.id)} disabled={disabled}>
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Botón que pide una segunda confirmación (sin diálogos del navegador). */
export function ConfirmButton({
  children,
  onConfirm,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className ?? ''} ${armed ? 'danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? '¿Seguro? Clic de nuevo' : children}
    </button>
  );
}
