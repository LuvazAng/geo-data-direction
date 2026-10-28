import type { Job } from '@protocol';
import { api } from '../api';
import { duration, JobCard, StageBar, time, useNow } from '../common';
import { isActive, isFinished } from '../state';
import type { Centro } from '../useCentro';

/** Lo que está corriendo ahora: etapas, archivos que se están tocando, últimos registros, y la actividad real de Qwen y Pi. */
export function RunningView({ centro, online, openJob }: { centro: Centro; online: boolean; openJob: (id: string) => void }) {
  const { state, call } = centro;
  const now = useNow(1000);
  const running = Object.values(state.jobs).filter(isActive);
  const last = Object.values(state.jobs)
    .filter(isFinished)
    .sort((a, b) => (b.finalizadoEn ?? '').localeCompare(a.finalizadoEn ?? ''))
    .slice(0, 3);
  const m = state.modelos;

  return (
    <div className="cc-running">
      <section className="cc-card cc-models">
        <div>
          <b>Qwen</b> <span className="muted small">{m?.qwen.modelo}</span>
          <div className="small">
            {m?.qwen.actual ? (
              <>
                <span className="cc-spinner" /> {m.qwen.actual.tarea} · pedido por {m.qwen.actual.origen} · {duration(now - Date.parse(m.qwen.actual.desde))}
              </>
            ) : (
              <span className="muted">sin tareas ahora</span>
            )}
            {m && m.qwen.enEspera > 0 && <span> · {m.qwen.enEspera} en espera</span>}
          </div>
          {m?.qwen.ultima && (
            <div className="small muted">
              última: {m.qwen.ultima.tarea} · {m.qwen.ultima.ok ? 'bien' : `falló (${m.qwen.ultima.detalle})`} · {duration(m.qwen.ultima.ms)} ·{' '}
              {time(m.qwen.ultima.hasta)}
            </div>
          )}
        </div>
        <div>
          <b>Pi CLI</b> <span className="muted small">{m?.pi.version ? `v${m.pi.version}` : ''}</span>
          <div className="small">
            {m?.pi.enCurso ? (
              <>
                <span className="cc-spinner" /> explicando {m.pi.enCurso.jobId}
                {m.pi.enCurso.pid ? ` (pid ${m.pi.enCurso.pid})` : ' (esperando al modelo)'} · {duration(now - Date.parse(m.pi.enCurso.desde))}
              </>
            ) : (
              <span className="muted">{m?.pi.disponible ? 'sin ejecutarse ahora' : m?.pi.detalle}</span>
            )}
          </div>
          {m?.pi.ultima && (
            <div className="small muted">
              última: {m.pi.ultima.jobId} · código {m.pi.ultima.codigo} · {duration(m.pi.ultima.ms)} · {time(m.pi.ultima.hasta)}
            </div>
          )}
        </div>
      </section>

      {running.length === 0 && <p className="muted">No hay ejecuciones en curso.</p>}
      {running.map((j) => (
        <RunningJob key={j.id} job={j} centro={centro} online={online} openJob={openJob} onCancel={() => void call(() => api.cancel(j.id))} />
      ))}

      {last.length > 0 && (
        <>
          <h3>Terminadas hace poco</h3>
          {last.map((j) => (
            <JobCard key={j.id} job={j} onOpen={openJob} compact />
          ))}
        </>
      )}
    </div>
  );
}

function RunningJob({
  job,
  centro,
  online,
  openJob,
  onCancel,
}: {
  job: Job;
  centro: Centro;
  online: boolean;
  openJob: (id: string) => void;
  onCancel: () => void;
}) {
  const { state } = centro;
  const files = state.archivosVivos
    .filter((f) => f.jobId === job.id)
    .slice(-8)
    .reverse();
  const logs = state.logs.filter((l) => l.jobId === job.id && l.nivel !== 'DEBUG').slice(-10);
  const cancelable = !['salida', 'reporte'].includes(job.etapa ?? '') && !job.cancelacionSolicitada;
  return (
    <section className="cc-card cc-run">
      <JobCard job={job} onOpen={openJob} compact />
      <StageBar job={job} />
      <div className="row">
        <button
          disabled={!online || !cancelable}
          onClick={onCancel}
          title={cancelable ? 'Se detiene en el siguiente punto seguro' : 'Escribiendo resultados: no es seguro cancelar ahora'}
        >
          {job.cancelacionSolicitada ? 'Cancelación solicitada…' : 'Cancelar'}
        </button>
        <button onClick={() => openJob(job.id)}>Detalles y registros</button>
      </div>
      {files.length > 0 && (
        <div className="cc-live-files">
          <div className="cc-list-title">Archivos (en vivo)</div>
          {files.map((f) => (
            <div key={`${f.mapa}|${f.rel}`} className="small">
              <span className={`cc-badge ${fileTone(f.estado)}`}>{f.estado}</span> {f.detalle ?? f.rel ?? f.mapa}
            </div>
          ))}
        </div>
      )}
      <div className="cc-mini-console">
        {logs.map((l) => (
          <div key={l.seq} className={`lv-${l.nivel}`}>
            <span className="muted">{time(l.ts)}</span> [{l.componente}] {l.mensaje}
          </div>
        ))}
      </div>
    </section>
  );
}

export const fileTone = (estado: string) =>
  ['error', 'conflicto', 'falta'].includes(estado)
    ? 'err'
    : ['revision', 'modificado', 'obsoleto', 'no-registrado'].includes(estado)
      ? 'warn'
      : ['descargando', 'en-proceso', 'detectado'].includes(estado)
        ? 'run'
        : estado === 'pendiente'
          ? 'idle'
          : 'ok';
