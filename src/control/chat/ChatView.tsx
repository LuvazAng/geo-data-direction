import { useEffect, useRef, useState } from 'react';
import { Icon, Popover, Term } from '@ui';
import {
  ESFUERZOS,
  PRESUPUESTO_RAZONAMIENTO,
  type Action,
  type ChatBlock,
  type ChatMessage,
  type ChatOptions,
  type Esfuerzo,
  type ModelInfo,
  type QwenTurn,
} from '@protocol';
import { api } from '../api';
import { ConfirmButton, duration, JobCard, time, useNow } from '../common';
import { define } from '../glossary';
import { Markdown } from './markdown';
import { conversationOf } from '../state';
import type { Centro } from '../useCentro';

export interface Navigate {
  openJob: (id: string) => void;
  openRoute: (lote: string, ruta: string) => void;
  openFile: (lote: string, rel: string) => void;
  openInEditor: (lote: string, rel: string) => void;
  openReview: (
    lote: string,
    rel: string,
    traza: string,
    indice: number,
    nombres: { indice: number; nombre: string }[],
    totalTrazos: number,
    pendientes: { traza: string; indice: number; nombre?: string }[],
    /** Mapa sin itinerarios que se evalúa a mano (todos sus trazos); sin él, se resuelven sus conflictos. */
    mapa?: string,
  ) => void;
}

const QUICK: { label: string; text?: string; action?: Action }[] = [
  { label: 'Pendientes', text: 'Muéstrame las rutas pendientes de procesar' },
  { label: 'Procesar la siguiente', action: { tipo: 'ejecutar-siguiente' } },
  { label: 'Elegir la siguiente', text: 'Quiero seleccionar manualmente cuál ruta sigue' },
  { label: 'Fallidas', text: 'Muéstrame los archivos que fallaron' },
  { label: 'Resultados', text: '¿Qué archivos se generaron y dónde se guardaron?' },
  { label: '¿Qué hace Qwen?', text: '¿Qué está haciendo Qwen en este momento?' },
  { label: 'Pi CLI', text: 'Muéstrame los últimos mensajes de Pi CLI' },
];

const PREFS_KEY = 'centro.chat.qwen';
export type Prefs = Required<Pick<ChatOptions, 'conversar' | 'esfuerzo'>>;
const DEFAULT_PREFS: Prefs = { conversar: true, esfuerzo: 'bajo' };

const ESFUERZO_LABEL: Record<Esfuerzo, string> = { ninguno: 'Sin razonar (rápido)', bajo: 'Bajo', medio: 'Medio', alto: 'Alto' };
const esfuerzoText = (e: Esfuerzo) =>
  `${ESFUERZO_LABEL[e]}${PRESUPUESTO_RAZONAMIENTO[e] ? ` · hasta ${PRESUPUESTO_RAZONAMIENTO[e].toLocaleString('es-MX')} tokens` : ''}`;

/** Preferencias de Qwen en el chat, recordadas en este navegador. */
function useQwenPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs> & { pensar?: boolean };
      // antes había sólo «razonar sí/no»
      const esfuerzo = ESFUERZOS.includes(saved.esfuerzo as Esfuerzo) ? saved.esfuerzo! : saved.pensar === false ? 'ninguno' : DEFAULT_PREFS.esfuerzo;
      return { conversar: saved.conversar ?? DEFAULT_PREFS.conversar, esfuerzo };
    } catch {
      return DEFAULT_PREFS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento local */
    }
  }, [prefs]);
  return [prefs, setPrefs] as const;
}

/** Cómo responde Qwen en el chat: si contesta en texto y cuánto razona antes de hacerlo. */
export function QwenSettings({ prefs, onChange }: { prefs: Prefs; onChange: (prefs: Prefs) => void }) {
  return (
    <>
      <label className="check" title="Lo que escribe Qwen nunca se ejecuta">
        <input type="checkbox" checked={prefs.conversar} onChange={(e) => onChange({ ...prefs, conversar: e.target.checked })} />
        <span>
          Qwen responde
          <small className="muted">Además de la respuesta del centro (datos reales y acciones), Qwen contesta en texto a cada mensaje que escribas.</small>
        </span>
      </label>
      <label className="cc-setting">
        <span className={prefs.conversar ? '' : 'muted'}>Razonamiento</span>
        <select value={prefs.esfuerzo} disabled={!prefs.conversar} onChange={(e) => onChange({ ...prefs, esfuerzo: e.target.value as Esfuerzo })}>
          {ESFUERZOS.map((e) => (
            <option key={e} value={e}>
              {esfuerzoText(e)}
            </option>
          ))}
        </select>
        <small className="muted">
          Cuánto razona Qwen antes de responder. Sin razonar: 1–3 s; bajo: unos 5–10 s; medio: ~20–30 s; alto: hasta ~1 min. Si agota su presupuesto, se le pide
          responder con lo que ya pensó.
        </small>
      </label>
    </>
  );
}

export function ChatView({ centro, nav, online }: { centro: Centro; nav: Navigate; online: boolean }) {
  const { state, send, act, busy, conversacion, selectConversation, newConversation } = centro;
  const [text, setText] = useState('');
  const [prefs, setPrefs] = useQwenPrefs();
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = state.chat.filter((m) => conversationOf(m) === conversacion);

  useEffect(() => {
    stick.current = true;
  }, [conversacion]);
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.chat, conversacion]);

  const ask = (t: string) => {
    stick.current = true;
    void send(t, prefs);
  };
  const submit = () => {
    const t = text.trim();
    if (!t || !online || !conversacion) return;
    setText('');
    ask(t);
  };

  return (
    <div className="cc-chat-view">
      <div className="cc-chat-head">
        <select
          className="cc-conv-select"
          value={conversacion ?? ''}
          disabled={!state.conversaciones.length}
          onChange={(e) => selectConversation(e.target.value)}
          title="Conversación: Qwen sólo relee los mensajes de la conversación en la que le preguntas"
        >
          {state.conversaciones.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titulo} · {new Date(c.actualizadaEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
            </option>
          ))}
        </select>
        <button
          onClick={() => void newConversation()}
          disabled={!online || busy}
          title="Empieza una conversación sin historial: Qwen no relee los mensajes anteriores"
        >
          <Icon name="plus" size={14} /> Nuevo chat
        </button>
        <Popover icon="tools" label="Ajustes" title="Ajustes de Qwen en el chat">
          <QwenSettings prefs={prefs} onChange={setPrefs} />
        </Popover>
      </div>
      <div className="cc-qwen-bar">
        <QwenState modelos={state.modelos} />
      </div>
      <div
        className="cc-messages"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && (
          <div className="cc-empty-chat">
            <h3>Habla con el centro</h3>
            <p>
              Escribe lo que necesitas, por ejemplo «muéstrame las rutas pendientes» o «procesa la ruta 2». También puedes hacerle cualquier pregunta a{' '}
              <Term definition={define('qwen')}>Qwen</Term>.
            </p>
            <p className="small muted">
              El centro sólo puede consultar y controlar el procesamiento. Lo que escribe Qwen es texto para leer y nunca se ejecuta. Qwen sólo relee los
              mensajes de esta conversación.
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.rol === 'qwen' ? (
            <QwenMessage key={m.id} m={m} centro={centro} nav={nav} online={online} onSuggest={ask} />
          ) : (
            <Message key={m.id} m={m} centro={centro} nav={nav} online={online} onSuggest={ask} />
          ),
        )}
      </div>
      <div className="cc-quick">
        {QUICK.map((q) => (
          <button key={q.label} disabled={!online || busy} onClick={() => (q.action ? void act(q.action) : ask(q.text!))}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="cc-input">
        <textarea
          value={text}
          rows={2}
          placeholder={
            online
              ? prefs.conversar
                ? 'Escribe una solicitud o pregúntale a Qwen… (Enter envía, Shift+Enter salto de línea)'
                : 'Escribe una solicitud… (Enter envía, Shift+Enter salto de línea)'
              : 'Sin conexión con el servidor del centro'
          }
          disabled={!online || !conversacion}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="primary" onClick={submit} disabled={!online || !text.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}

function Message({ m, centro, nav, online, onSuggest }: { m: ChatMessage; centro: Centro; nav: Navigate; online: boolean; onSuggest: (t: string) => void }) {
  return (
    <div className={`cc-msg ${m.rol}${m.parcial ? ' parcial' : ''}`}>
      <div className="cc-msg-meta">
        {m.rol === 'usuario' ? 'Tú' : 'Centro'} · {time(m.ts)}
        {m.interpretacion && m.rol === 'sistema' && m.interpretacion.via !== 'boton' && (
          <span className="muted" title="Cómo se entendió el mensaje">
            {' '}
            · {m.interpretacion.intencion} ({m.interpretacion.via}
            {m.interpretacion.ms ? `, ${m.interpretacion.ms} ms` : ''})
          </span>
        )}
        {m.parcial && <span className="cc-spinner" aria-label="escribiendo" />}
      </div>
      {m.texto && <div className="cc-msg-text">{m.texto}</div>}
      {m.bloques.map((b, i) => (
        <Block key={i} b={b} centro={centro} nav={nav} online={online} onSuggest={onSuggest} />
      ))}
    </div>
  );
}

/** Qué está haciendo el modelo ahora (lo publica el servidor cuando cambia). */
function QwenState({ modelos }: { modelos: ModelInfo | null }) {
  const q = modelos?.qwen;
  if (!q) return null;
  return (
    <span
      className="cc-qwen-state small"
      title={
        q.ultima
          ? `Última: ${q.ultima.tarea} (${q.ultima.origen}) — ${q.ultima.ok ? 'bien' : `falló: ${q.ultima.detalle ?? ''}`}, ${duration(q.ultima.ms)}`
          : undefined
      }
    >
      {q.actual ? (
        <>
          <span className="cc-spinner" aria-hidden /> {q.modelo}: {q.actual.tarea} ({q.actual.origen})
        </>
      ) : (
        <span className="muted">{q.modelo} libre</span>
      )}
      {q.enEspera > 0 && <span className="muted"> · {q.enEspera} en espera</span>}
    </span>
  );
}

const FASE: Record<QwenTurn['fase'], string> = {
  esperando: 'esperando turno del modelo…',
  cargando: 'leyendo el contexto…',
  pensando: 'razonando…',
  respondiendo: 'respondiendo…',
  listo: '',
  detenido: 'detenido',
  error: 'con error',
};

function Elapsed({ since }: { since: string }) {
  const now = useNow(1000);
  return <span className="muted">{duration(Math.max(0, now - Date.parse(since)))}</span>;
}

/** Razonamiento de Qwen: abierto y siguiendo el texto mientras razona; plegado después. */
function Thinking({ text, live, recortado }: { text: string; live: boolean; recortado?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live]);
  return (
    <details className="cc-think" open={live}>
      <summary>
        Razonamiento ({text.length.toLocaleString('es-MX')} caracteres){live ? ' — en curso' : recortado ? ' — recortado al presupuesto' : ''}
      </summary>
      <div className="cc-think-body" ref={box}>
        <Markdown text={text} streaming={live} />
      </div>
    </details>
  );
}

function QwenMessage({
  m,
  centro,
  nav,
  online,
  onSuggest,
}: {
  m: ChatMessage;
  centro: Centro;
  nav: Navigate;
  online: boolean;
  onSuggest: (t: string) => void;
}) {
  const q = m.qwen;
  const live = !!m.parcial;
  const stats =
    q && !live && q.fase !== 'esperando'
      ? [
          q.ms !== undefined && duration(q.ms),
          q.cargaMs && q.cargaMs > 500 && `carga del modelo ${duration(q.cargaMs)}`,
          q.primerTokenMs !== undefined && `primer token a los ${duration(q.primerTokenMs)}`,
          q.tokens?.entrada && `${q.tokens.entrada.toLocaleString('es-MX')} tokens de contexto`,
          q.tokens?.salida && `${q.tokens.salida.toLocaleString('es-MX')} generados`,
          q.tokPorSeg && `${q.tokPorSeg} tok/s`,
          q.esfuerzo ? `razonamiento: ${ESFUERZO_LABEL[q.esfuerzo].toLowerCase()}` : q.pensar ? 'con razonamiento' : 'sin razonamiento',
          q.recortado && `recortado a ${q.presupuesto?.toLocaleString('es-MX')} tokens`,
          q.motivo === 'length' && 'cortado por longitud',
        ].filter(Boolean)
      : [];
  return (
    <div className={`cc-msg qwen${live ? ' parcial' : ''}`}>
      <div className="cc-msg-meta">
        Qwen{q ? ` · ${q.modelo}` : ''} · {time(m.ts)}
        {live && q && (
          <>
            <span className="cc-spinner" aria-label="escribiendo" /> {FASE[q.fase]} <Elapsed since={m.ts} />
            <button
              className="link"
              disabled={!online}
              onClick={() => void centro.call(() => api.stopQwen(m.id))}
              title="Detener la respuesta (lo ya escrito se conserva)"
            >
              Detener
            </button>
          </>
        )}
        {!live && q && (q.fase === 'detenido' || q.fase === 'error') && <span className="muted"> · {FASE[q.fase]}</span>}
      </div>
      {q?.razonamiento && <Thinking text={q.razonamiento} live={live && q.fase === 'pensando'} recortado={q.recortado} />}
      {m.texto.trim() && <Markdown text={m.texto} streaming={live && q?.fase === 'respondiendo'} />}
      {m.bloques.map((b, i) => (
        <Block key={i} b={b} centro={centro} nav={nav} online={online} onSuggest={onSuggest} />
      ))}
      {stats.length > 0 && <div className="cc-qwen-stats">{stats.join(' · ')}</div>}
    </div>
  );
}

function Block({ b, centro, nav, online, onSuggest }: { b: ChatBlock; centro: Centro; nav: Navigate; online: boolean; onSuggest: (t: string) => void }) {
  const { state, act, busy, call } = centro;
  switch (b.tipo) {
    case 'texto':
      return <p className="cc-text">{b.texto}</p>;
    case 'error':
      return <p className="cc-text cc-err-text">⚠ {b.texto}</p>;
    case 'lista':
      return (
        <div className="cc-list">
          {b.titulo && <div className="cc-list-title">{b.titulo}</div>}
          <ul>
            {b.items.map((it, i) => (
              <li key={i} className={it.estado ? `st-${it.estado}` : ''}>
                {it.texto}
                {it.detalle && <div className="small muted">{it.detalle}</div>}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'opciones':
      return (
        <div className="cc-options">
          {b.titulo && <div className="cc-list-title">{b.titulo}</div>}
          <div className="row">
            {b.opciones.map((o, i) =>
              o.peligrosa ? (
                <ConfirmButton key={i} disabled={!online || busy} onConfirm={() => void act(o.accion)}>
                  {o.etiqueta}
                </ConfirmButton>
              ) : (
                <button key={i} disabled={!online || busy} onClick={() => void act(o.accion)}>
                  {o.etiqueta}
                </button>
              ),
            )}
          </div>
        </div>
      );
    case 'ejecucion': {
      const job = state.jobs[b.jobId];
      if (!job) return <p className="small muted">Ejecución {b.jobId} (ya no está en la lista reciente)</p>;
      return (
        <JobCard
          job={job}
          onOpen={nav.openJob}
          disabled={!online || busy}
          onCancel={(id) => void act({ tipo: 'cancelar', jobId: id })}
          onRetry={(id) => void act({ tipo: 'reintentar', jobId: id })}
        />
      );
    }
    case 'archivos':
      return (
        <div className="cc-list">
          {b.titulo && <div className="cc-list-title">{b.titulo}</div>}
          <ul className="cc-files-inline">
            {b.items.slice(0, 40).map((f) => (
              <li key={f.rel}>
                <code>{f.rel}</code> <span className={`cc-badge ${f.tipo === 'revision' ? 'warn' : 'ok'}`}>{f.tipo}</span>
                {f.detalle && <span className="small muted"> {f.detalle}</span>}
                <span className="row inline">
                  <button className="link" onClick={() => nav.openFile(b.lote, f.rel)}>
                    Detalles
                  </button>
                  <button className="link" onClick={() => void call(async () => nav.openInEditor(b.lote, f.rel))}>
                    Abrir en el editor
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {b.items.length > 40 && <div className="small muted">… y {b.items.length - 40} más (ver «Carpetas y archivos»)</div>}
        </div>
      );
    case 'sugerencias':
      return (
        <div className="cc-suggest">
          {b.items.map((s) => (
            <button key={s} className="chip" disabled={!online} onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      );
    case 'ruta':
      return (
        <button className="link" onClick={() => nav.openRoute(b.lote, b.ruta)}>
          Ver carpetas y archivos de {b.ruta} →
        </button>
      );
  }
}
