import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@ui';
import type { Job, LogEntry } from '@protocol';
import { api, type FileDetail, type JobReport } from '../api';
import { ConfirmButton, dateTime, duration, JobBadge, jobDuration, jobTitle, StageBar, STAGE_LABEL, time } from '../common';
import type { Navigate } from '../chat/ChatView';
import { formatLog } from '../logs/ConsoleView';
import { isActive, isFinished } from '../state';
import type { Centro } from '../useCentro';

function Modal({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="cc-modal-back" onClick={onClose}>
      <div className="cc-modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header>
          <div>{title}</div>
          <button className="icon" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="cc-modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Detalle de una ejecución: se actualiza con los eventos mientras corre. */
export function JobDetail({ id, centro, nav, onClose, online }: { id: string; centro: Centro; nav: Navigate; onClose: () => void; online: boolean }) {
  const { state, call, act } = centro;
  const [fetched, setFetched] = useState<Job | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [report, setReport] = useState<JobReport | null>(null);
  const [tab, setTab] = useState<'resumen' | 'archivos' | 'registros' | 'reporte'>('resumen');
  const job = state.jobs[id] ?? fetched;
  const finished = job ? isFinished(job) : false;

  useEffect(() => {
    if (!state.jobs[id])
      api
        .job(id)
        .then(setFetched)
        .catch(() => {});
  }, [id, state.jobs]);
  useEffect(() => {
    api
      .jobLogs(id)
      .then(setLogs)
      .catch(() => {});
  }, [id, finished]);
  useEffect(() => {
    if (finished)
      api
        .jobReport(id)
        .then(setReport)
        .catch(() => {});
  }, [id, finished]);

  const allLogs = useMemo(() => {
    const seen = new Set(logs.map((l) => l.seq));
    return [...logs, ...state.logs.filter((l) => l.jobId === id && !seen.has(l.seq))];
  }, [logs, state.logs, id]);

  if (!job)
    return (
      <Modal title="Ejecución" onClose={onClose}>
        Cargando…
      </Modal>
    );
  const disabled = !online;

  return (
    <Modal
      title={
        <>
          <b>{jobTitle(job)}</b>{' '}
          <span className="muted small">
            {job.lote} · {job.id}
          </span>{' '}
          <JobBadge job={job} />
        </>
      }
      onClose={onClose}
    >
      <div className="row">
        {job.estado === 'PENDIENTE' && (
          <>
            <button disabled={disabled} onClick={() => void call(() => api.start(job.id))}>
              Iniciar
            </button>
            <button disabled={disabled} onClick={() => void call(() => api.first(job.id))}>
              Al frente
            </button>
          </>
        )}
        {(isActive(job) || job.estado === 'PENDIENTE') && (
          <ConfirmButton
            disabled={disabled || ['salida', 'reporte'].includes(job.etapa ?? '') || job.cancelacionSolicitada}
            onConfirm={() => void call(() => api.cancel(job.id))}
          >
            Cancelar
          </ConfirmButton>
        )}
        {['FALLIDO', 'CANCELADO', 'INTERRUMPIDO', 'COMPLETADO_CON_ADVERTENCIAS'].includes(job.estado) && (
          <button
            disabled={disabled}
            onClick={() => void call(() => api.retry(job.id))}
            title="Nueva ejecución desde el principio (no vuelve a descargar lo que ya está)"
          >
            Reintentar
          </button>
        )}
        {finished && (
          <button
            disabled={disabled}
            onClick={() => void act({ tipo: 'explicar-con-pi', jobId: job.id })}
            title="Pi CLI redacta un resumen; la respuesta llega al chat"
          >
            Explicar con Pi
          </button>
        )}
        {job.unidad.tipo === 'ruta' && <button onClick={() => (nav.openRoute(job.lote, (job.unidad as { slug: string }).slug), onClose())}>Ver carpeta</button>}
      </div>
      <nav className="cc-tabs small-tabs">
        {(['resumen', 'archivos', 'registros', 'reporte'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} disabled={t === 'reporte' && !finished}>
            {t === 'resumen'
              ? 'Resumen'
              : t === 'archivos'
                ? `Archivos (${job.archivosEntrada.length + job.archivosSalida.length})`
                : t === 'registros'
                  ? `Registros (${allLogs.length})`
                  : 'Reporte'}
          </button>
        ))}
      </nav>

      {tab === 'resumen' && (
        <div>
          <StageBar job={job} />
          <table className="cc-table">
            <tbody>
              <tr>
                <th>Creada</th>
                <td>
                  {dateTime(job.creadoEn)} · desde {job.origen}
                </td>
              </tr>
              <tr>
                <th>Inicio / fin</th>
                <td>
                  {dateTime(job.iniciadoEn)} → {dateTime(job.finalizadoEn)} ({duration(jobDuration(job))})
                </td>
              </tr>
              <tr>
                <th>Parámetros</th>
                <td>
                  {job.parametros.sinRed ? 'sin red' : 'con red'} · {job.parametros.sinIa ? 'sin IA' : 'con Qwen'}
                  {job.parametros.refrescar ? ' · volver a descargar' : ''}
                </td>
              </tr>
              <tr>
                <th>Intento</th>
                <td>
                  {job.intento}
                  {job.reintentoDe ? ` (reintento de ${job.reintentoDe})` : ''}
                </td>
              </tr>
              {job.resultado && (
                <tr>
                  <th>Resultado</th>
                  <td>
                    {job.resultado.mapas} mapas ({job.resultado.mapasConError} con error) · {job.resultado.trazos} trazos ·{' '}
                    <b>{job.resultado.generados} generados</b> · {job.resultado.revision} en revisión
                  </td>
                </tr>
              )}
              <tr>
                <th>Etapas</th>
                <td className="small">
                  {Object.entries(job.tiempos)
                    .map(([k, v]) => `${STAGE_LABEL[k] ?? k} ${duration(v)}`)
                    .join(' · ') || '—'}
                </td>
              </tr>
            </tbody>
          </table>
          {job.errores.length > 0 && (
            <div className="cc-list">
              <div className="cc-list-title">Errores</div>
              <ul>
                {job.errores.map((e, i) => (
                  <li key={i} className="cc-err-text">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {job.advertencias.length > 0 && (
            <div className="cc-list">
              <div className="cc-list-title">Advertencias</div>
              <ul>
                {job.advertencias.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'archivos' && (
        <div>
          <div className="cc-list-title">Entrada (originales)</div>
          <ul className="cc-files-inline">
            {job.archivosEntrada.map((rel) => (
              <li key={rel}>
                <code>{rel}</code>{' '}
                <button className="link" onClick={() => nav.openFile(job.lote, rel)}>
                  Detalles
                </button>
              </li>
            ))}
            {job.archivosEntrada.length === 0 && <li className="muted small">—</li>}
          </ul>
          <div className="cc-list-title">Salida</div>
          <ul className="cc-files-inline">
            {job.archivosSalida.map((f) => (
              <li key={f.rel}>
                <span className={`cc-badge ${f.tipo === 'revision' ? 'warn' : 'ok'}`}>{f.tipo}</span> <code>{f.rel}</code>{' '}
                <span className="small muted">{f.estado}</span>
                <span className="row inline">
                  <button className="link" onClick={() => nav.openFile(job.lote, f.rel)}>
                    Detalles
                  </button>
                  <button className="link" onClick={() => void call(async () => nav.openInEditor(job.lote, f.rel))}>
                    Abrir en el editor
                  </button>
                </span>
              </li>
            ))}
            {job.archivosSalida.length === 0 && <li className="muted small">—</li>}
          </ul>
        </div>
      )}

      {tab === 'registros' && (
        <div>
          <div className="row">
            <button onClick={() => void navigator.clipboard?.writeText(allLogs.map(formatLog).join('\n'))}>Copiar registros</button>
          </div>
          <div className="cc-console-lines tall">
            {allLogs.map((l) => (
              <div key={l.seq} className={`cc-line lv-${l.nivel}`}>
                <span className="t">{time(l.ts)}</span> <span className="lvl">{l.nivel}</span> <span className="comp">[{l.componente}]</span>{' '}
                <span className="msg">{l.mensaje}</span>
                {l.duracionMs !== undefined && <span className="dur"> {duration(l.duracionMs)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'reporte' && (
        <div>
          {!report && <p className="muted">Sin reporte (la ejecución no llegó a generarlo).</p>}
          {report && (
            <>
              <p className="small muted">Reporte completo en el lote: {job.resultado?.reporte}</p>
              <div className="cc-list-title">Trazos principales</div>
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>Mapa</th>
                    <th>DESCRIPCIO</th>
                    <th>Origen → destino</th>
                    <th>Sentido</th>
                    <th>Archivo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trazos
                    .filter((t) => t.rol === 'principal')
                    .map((t) => (
                      <tr key={t.id} className={t.estado === 'REQUIERE_REVISION' ? 'warn-row' : ''}>
                        <td className="small">
                          {t.tituloMapa} #{t.indice}
                        </td>
                        <td className="small">{t.descripcion || t.nombreOriginal}</td>
                        <td>
                          {t.origen ?? '¿?'} → {t.destino ?? '¿?'}
                        </td>
                        <td className="small">
                          {t.sentido}
                          <div className="muted">{t.metodo}</div>
                        </td>
                        <td className="small">
                          {t.nombreFinal ?? (t.nombrePropuesto ? `propuesto: ${t.nombrePropuesto}` : '—')}
                          {t.motivosRevision.length > 0 && <div className="cc-err-text">{t.motivosRevision.join('; ')}</div>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {report.ia.intervenciones.length > 0 && (
                <div className="cc-list">
                  <div className="cc-list-title">Qwen</div>
                  <ul>
                    {report.ia.intervenciones.map((i, k) => (
                      <li key={k}>
                        <b>{i.titulo}</b> ({i.enCache ? 'caché' : duration(i.ms)}): {i.cambios.join('; ') || 'sin cambios'}
                        <div className="small muted">{i.error ?? i.explicacion}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.duplicados.length > 0 && (
                <div className="cc-list">
                  <div className="cc-list-title">Posibles duplicados con otras rutas ({report.duplicados.length})</div>
                  <ul>
                    {report.duplicados.slice(0, 20).map((d, k) => (
                      <li key={k} className="small">
                        {d.clase} ({Math.round(d.similitud * 100)} %): {d.rutaA} «{d.tituloA}» ↔ {d.rutaB} «{d.tituloB}»
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function FileDetailModal({ lote, rel, centro, nav, onClose }: { lote: string; rel: string; centro: Centro; nav: Navigate; onClose: () => void }) {
  const [d, setD] = useState<FileDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const version = centro.state.version[lote] ?? 0;
  useEffect(() => {
    api
      .file(lote, rel)
      .then(setD)
      .catch((e) => setErr((e as Error).message));
  }, [lote, rel, version]);
  return (
    <Modal title={<code>{rel}</code>} onClose={onClose}>
      {err && <p className="cc-err-text">{err}</p>}
      {!d && !err && <p className="muted">Cargando…</p>}
      {d && (
        <div>
          <div className="row">
            <button className="primary" onClick={() => void centro.call(async () => nav.openInEditor(lote, rel))}>
              Abrir en el editor
            </button>
            <button onClick={() => void navigator.clipboard?.writeText(rel)}>Copiar ruta</button>
          </div>
          <table className="cc-table">
            <tbody>
              <tr>
                <th>Tamaño</th>
                <td>
                  {(d.bytes / 1024).toFixed(1)} KB · modificado {dateTime(d.modificadoEn)}
                </td>
              </tr>
              <tr>
                <th>SHA-256</th>
                <td>
                  <code className="small">{d.sha256}</code>
                </td>
              </tr>
              {d.registro && (
                <tr>
                  <th>Manifiesto</th>
                  <td>
                    {d.registro.tipo} · generado {dateTime(d.registro.generadoEn)} ·{' '}
                    {d.registro.coincide ? 'sin cambios desde que se generó' : <b className="cc-err-text">modificado después de generarse</b>}
                    <div className="small muted">original: {d.registro.original}</div>
                  </td>
                </tr>
              )}
              {!d.registro && rel.startsWith('resultados/') && (
                <tr>
                  <th>Manifiesto</th>
                  <td className="cc-err-text">no registrado por el orquestador</td>
                </tr>
              )}
              {d.mapa && (
                <tr>
                  <th>Mapa de origen</th>
                  <td>
                    {d.mapa.titulo} · {d.mapa.ruta} · {d.mapa.estado.toLowerCase().replace(/_/g, ' ')}
                    {d.mapa.descargadoEn && <span className="small muted"> · descargado {dateTime(d.mapa.descargadoEn)}</span>}
                    <div className="small">
                      <a href={d.mapa.url} target="_blank" rel="noreferrer noopener">
                        {d.mapa.url}
                      </a>
                    </div>
                    {d.mapa.error && <div className="small cc-err-text">{d.mapa.error}</div>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {d.traza && (
            <div className="cc-card">
              <div className="cc-list-title">Decisión del orquestador</div>
              <p>
                <b>
                  {d.traza.origen ?? '¿?'} → {d.traza.destino ?? '¿?'}
                </b>
                {d.traza.via && ` · por ${d.traza.via}`} · {d.traza.sentido} ({d.traza.puntaje > 0 ? '+' : ''}
                {d.traza.puntaje}) · {d.traza.metodo}
              </p>
              <p className="small muted">
                DESCRIPCIO: {d.traza.descripcion || '—'} · nombre: {d.traza.nombreFinal ?? `propuesto ${d.traza.nombrePropuesto ?? '—'}`}
                {d.traza.similitudDupla && ` · dupla ${Math.round(d.traza.similitudDupla.similitud * 100)} % ${d.traza.similitudDupla.clase}`}
              </p>
              <ul>
                {d.traza.evidencias.map((e, i) => (
                  <li key={i} className="small">
                    <span className={`cc-badge ${e.peso > 0 ? 'ok' : e.peso < 0 ? 'err' : 'idle'}`}>{e.peso > 0 ? `+${e.peso}` : e.peso}</span> {e.fuente}:{' '}
                    {e.detalle}
                  </li>
                ))}
              </ul>
              {d.traza.motivosRevision.length > 0 && <p className="cc-err-text small">Revisión: {d.traza.motivosRevision.join('; ')}</p>}
            </div>
          )}
          {d.trazas && d.trazas.length > 0 && (
            <div className="cc-list">
              <div className="cc-list-title">Trazos principales de este original</div>
              <ul>
                {d.trazas.map((t) => (
                  <li key={t.id} className="small">
                    #{t.indice} {t.descripcion} → {t.nombreFinal ?? t.estado.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
