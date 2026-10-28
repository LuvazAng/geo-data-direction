import { useMemo, useState } from 'react';
import type { JobStatus } from '@protocol';
import { dateTime, duration, JobBadge, jobDuration, jobTitle, STATUS_LABEL } from './common';
import { isFinished } from './state';
import type { Centro } from './useCentro';

export function HistoryView({ centro, openJob }: { centro: Centro; openJob: (id: string) => void }) {
  const { state } = centro;
  const [estado, setEstado] = useState<JobStatus | ''>('');
  const [lote, setLote] = useState('');
  const jobs = useMemo(
    () =>
      Object.values(state.jobs)
        .filter(isFinished)
        .filter((j) => (!estado || j.estado === estado) && (!lote || j.lote === lote))
        .sort((a, b) => (b.finalizadoEn ?? '').localeCompare(a.finalizadoEn ?? '')),
    [state.jobs, estado, lote],
  );
  return (
    <div>
      <div className="row">
        <select value={estado} onChange={(e) => setEstado(e.target.value as JobStatus | '')}>
          <option value="">todos los estados</option>
          {(['COMPLETADO', 'COMPLETADO_CON_ADVERTENCIAS', 'FALLIDO', 'CANCELADO', 'INTERRUMPIDO'] as JobStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={lote} onChange={(e) => setLote(e.target.value)}>
          <option value="">todos los lotes</option>
          {state.lotes.map((l) => (
            <option key={l.lote}>{l.lote}</option>
          ))}
        </select>
        <span className="small muted">{jobs.length} ejecución(es) · se conservan las últimas al reiniciar el servidor</span>
      </div>
      {jobs.length === 0 && <p className="muted">Todavía no hay ejecuciones terminadas.</p>}
      <table className="cc-table cc-history">
        <thead>
          <tr>
            <th>Terminó</th>
            <th>Unidad</th>
            <th>Estado</th>
            <th>Duración</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => openJob(j.id)} className="clickable">
              <td className="small">{dateTime(j.finalizadoEn)}</td>
              <td>
                <b>{jobTitle(j)}</b> <span className="small muted">{j.lote}</span>
                <div className="small muted">
                  {j.id}
                  {j.intento > 1 ? ` · intento ${j.intento}` : ''}
                </div>
              </td>
              <td>
                <JobBadge job={j} />
              </td>
              <td className="small">{duration(jobDuration(j))}</td>
              <td className="small">
                {j.resultado
                  ? `${j.resultado.generados} generados · ${j.resultado.revision} en revisión · ${j.resultado.mapasConError} con error`
                  : (j.errores[j.errores.length - 1] ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
