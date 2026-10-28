import { useCallback, useMemo, useState } from 'react';
import { api } from './api';
import { ChatView, type Navigate } from './ChatView';
import { duration, jobTitle, useNow } from './common';
import { ConsoleView } from './ConsoleView';
import { FileDetailModal, JobDetail } from './Details';
import { FilesView } from './FilesView';
import { HistoryView } from './HistoryView';
import { QueueView } from './QueueView';
import { RunningView } from './RunningView';
import { isActive } from './state';
import type { Centro } from './useCentro';

type Tab = 'cola' | 'ejecucion' | 'archivos' | 'consola' | 'historial' | 'chat';

/**
 * Centro de control conversacional. Se abre encima del editor (que sigue montado con su estado).
 * Todo lo que muestra viene del servidor del centro; sin conexión no aparenta estar activo.
 */
export function ControlCenter({
  centro,
  open,
  onClose,
  onOpenFile,
  onOpenReview,
}: {
  centro: Centro;
  open: boolean;
  onClose: () => void;
  onOpenFile: (file: File) => void;
  onOpenReview: (
    file: File,
    lote: string,
    traza: string,
    indice: number,
    nombres: { indice: number; nombre: string }[],
    totalTrazos: number,
    pendientes: { traza: string; indice: number; nombre?: string }[],
    mapa?: string,
  ) => void;
}) {
  const { state, lastBeat, error, setError, call } = centro;
  const [tab, setTab] = useState<Tab>('cola');
  const [jobId, setJobId] = useState<string | null>(null);
  const [file, setFile] = useState<{ lote: string; rel: string } | null>(null);
  const [filesTarget, setFilesTarget] = useState<{ lote: string; ruta?: string } | null>(null);
  const now = useNow(1000);
  const online = state.conexion === 'conectado';
  const running = useMemo(() => Object.values(state.jobs).filter(isActive), [state.jobs]);

  const openInEditor = useCallback(
    async (lote: string, rel: string) => {
      const f = await api.fileBlob(lote, rel);
      onOpenFile(f);
    },
    [onOpenFile],
  );
  const nav: Navigate = useMemo(
    () => ({
      openJob: (id) => setJobId(id),
      openRoute: (lote, ruta) => {
        setFilesTarget({ lote, ruta });
        setTab('archivos');
      },
      openFile: (lote, rel) => setFile({ lote, rel }),
      openInEditor: (lote, rel) => void call(() => openInEditor(lote, rel)),
      openReview: (lote, rel, traza, indice, nombres, totalTrazos, pendientes, mapa) =>
        void call(async () => {
          const f = await api.fileBlob(lote, rel);
          onOpenReview(f, lote, traza, indice, nombres, totalTrazos, pendientes, mapa);
        }),
    }),
    [call, onOpenReview, openInEditor],
  );

  if (!open) return null;
  const pending = state.cola.orden.length;
  const stale = lastBeat ? Math.round((now - lastBeat) / 1000) : null;

  return (
    <div className="cc-overlay">
      <header className="cc-header">
        <h1>Centro de control</h1>
        <span
          className={`cc-conn ${state.conexion}`}
          title={state.servidor ? `Servidor ${state.servidor.version} · iniciado ${new Date(state.servidor.inicio).toLocaleString('es-MX')}` : ''}
        >
          {state.conexion === 'conectado'
            ? '● conectado'
            : state.conexion === 'reconectando'
              ? '◌ reconectando…'
              : state.conexion === 'conectando'
                ? '◌ conectando…'
                : '○ apagado'}
        </span>
        <div className="cc-header-run">
          {running.length ? (
            running.map((j) => (
              <button key={j.id} className="link" onClick={() => setJobId(j.id)}>
                <span className="cc-spinner" /> {jobTitle(j)} · {j.etapa ?? 'iniciando'}
                {j.progreso?.etapa === 'descarga' && ` ${j.progreso.hechos}/${j.progreso.total}`} ·{' '}
                {duration(now - Date.parse(j.iniciadoEn ?? new Date().toISOString()))}
              </button>
            ))
          ) : (
            <span className="muted small">nada en ejecución</span>
          )}
          <span className="small muted">
            · {pending} en cola{state.cola.pausada ? ' (en pausa)' : ''}
          </span>
        </div>
        <div className="row">
          {state.cola.pausada ? (
            <button disabled={!online} onClick={() => void call(api.resume)}>
              ▶ Reanudar cola
            </button>
          ) : (
            <button disabled={!online} onClick={() => void call(api.pause)}>
              ⏸ Pausar cola
            </button>
          )}
          <button onClick={onClose} title="Volver al editor (Esc). Las ejecuciones siguen en el servidor.">
            ✕ Editor
          </button>
        </div>
      </header>

      {!online && (
        <div className="cc-banner">
          {state.conexion === 'reconectando'
            ? `Sin conexión con el servidor del centro${stale !== null ? ` (último evento hace ${stale} s)` : ''}. Reintentando… Si no está corriendo, ábrelo con «npm run centro». Lo que se ve puede estar desactualizado y las acciones están deshabilitadas.`
            : 'Conectando con el servidor del centro…'}
        </div>
      )}
      {error && (
        <div className="cc-banner err" onClick={() => setError(null)} title="Clic para cerrar">
          {error}
        </div>
      )}

      <div className="cc-body">
        <section className={`cc-chat ${tab === 'chat' ? 'mobile-show' : ''}`}>
          <ChatView centro={centro} nav={nav} online={online} />
        </section>
        <section className="cc-main">
          <nav className="cc-tabs">
            <button className={`mobile-only ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
              Chat
            </button>
            {(
              [
                ['cola', `Cola (${pending})`],
                ['ejecucion', `En ejecución (${running.length})`],
                ['archivos', 'Carpetas y archivos'],
                ['consola', 'Consola'],
                ['historial', 'Historial'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="cc-tab-body">
            {state.conexion === 'conectando' && !state.servidor && <p className="muted">Cargando el estado del servidor…</p>}
            {tab === 'cola' && <QueueView centro={centro} online={online} openJob={nav.openJob} />}
            {tab === 'ejecucion' && <RunningView centro={centro} online={online} openJob={nav.openJob} />}
            {tab === 'archivos' && <FilesView centro={centro} nav={nav} target={filesTarget} />}
            {tab === 'consola' && <ConsoleView centro={centro} openJob={nav.openJob} />}
            {tab === 'historial' && <HistoryView centro={centro} openJob={nav.openJob} />}
          </div>
        </section>
      </div>

      {jobId && <JobDetail id={jobId} centro={centro} nav={nav} online={online} onClose={() => setJobId(null)} />}
      {file && <FileDetailModal lote={file.lote} rel={file.rel} centro={centro} nav={nav} onClose={() => setFile(null)} />}
    </div>
  );
}
