import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Icon, Term } from '@ui';
import { api } from './api';
import { ChatView, type Navigate } from './chat/ChatView';
import { duration, jobTitle, useNow } from './common';
import { ControlTools } from './ControlTools';
import { FileDetailModal, JobDetail } from './details/Details';
import { FilesView } from './files/FilesView';
import { define } from './glossary';
import { ConsoleView } from './logs/ConsoleView';
import { HistoryView } from './logs/HistoryView';
import { QueueView } from './queue/QueueView';
import { RunningView } from './queue/RunningView';
import { isActive } from './state';
import type { Centro } from './useCentro';

type Tab = 'cola' | 'ejecucion' | 'archivos' | 'consola' | 'historial' | 'chat';

/** Para qué sirve cada pestaña, en una frase que se lee al abrirla. */
const INTRO: Record<Exclude<Tab, 'chat'>, ReactNode> = {
  cola: (
    <>
      Elige qué <Term definition={define('ruta')}>ruta</Term> procesar y en qué orden. Cada <Term definition={define('ejecucion')}>ejecución</Term> descarga los
      mapas de la ruta, decide el origen, el destino y el sentido de cada trazo, y escribe los archivos.
    </>
  ),
  ejecucion: (
    <>
      Lo que está procesando el orquestador ahora mismo, y qué hacen <Term definition={define('qwen')}>Qwen</Term> y{' '}
      <Term definition={define('pi')}>Pi CLI</Term>.
    </>
  ),
  archivos: (
    <>
      Lo que se descargó y se generó en cada <Term definition={define('lote')}>lote</Term> y ruta. Aquí resuelves en el editor los casos de{' '}
      <Term definition={define('revision')}>revisión</Term>.
    </>
  ),
  consola: <>Los registros del orquestador en vivo. Filtra por componente, nivel, ruta o ejecución.</>,
  historial: <>Las ejecuciones que ya terminaron y su resultado. Abre una para ver sus archivos y registros.</>,
};

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
  const [toolsOpen, setToolsOpen] = useState(false);
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
          <span className="small muted">· {pending} en cola</span>
          {state.cola.pausada && <span className="small warn-text">· en pausa</span>}
        </div>
        <div className="row">
          <button onClick={() => setToolsOpen(true)}>
            <Icon name="tools" /> Herramientas
          </button>
          <button onClick={onClose} title="Volver al editor. Las ejecuciones siguen en el servidor.">
            <Icon name="x" /> Editor
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
              ] as [Exclude<Tab, 'chat'>, string][]
            ).map(([t, label]) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="cc-tab-body">
            {state.conexion === 'conectando' && !state.servidor && <p className="muted">Cargando el estado del servidor…</p>}
            {tab !== 'chat' && <p className="cc-intro">{INTRO[tab]}</p>}
            {tab === 'cola' && <QueueView centro={centro} online={online} openJob={nav.openJob} />}
            {tab === 'ejecucion' && <RunningView centro={centro} online={online} openJob={nav.openJob} />}
            {tab === 'archivos' && <FilesView centro={centro} nav={nav} target={filesTarget} />}
            {tab === 'consola' && <ConsoleView centro={centro} openJob={nav.openJob} />}
            {tab === 'historial' && <HistoryView centro={centro} openJob={nav.openJob} />}
          </div>
          {toolsOpen && <ControlTools centro={centro} online={online} onClose={() => setToolsOpen(false)} />}
        </section>
      </div>

      {jobId && <JobDetail id={jobId} centro={centro} nav={nav} online={online} onClose={() => setJobId(null)} />}
      {file && <FileDetailModal lote={file.lote} rel={file.rel} centro={centro} nav={nav} onClose={() => setFile(null)} />}
    </div>
  );
}
