import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Action, ChatMessage, ChatOptions, LogEntry, ServerEvent } from '@protocol';
import { api, ApiError } from './api';
import { initialState, reducer } from './state';

const EVENT_TYPES: ServerEvent['type'][] = [
  'snapshot',
  'job.created',
  'job.queued',
  'job.started',
  'job.stage_changed',
  'job.progress',
  'job.log',
  'job.file_detected',
  'job.file_updated',
  'job.completed',
  'job.failed',
  'job.cancelled',
  'queue.updated',
  'routes.updated',
  'folder.updated',
  'chat.message',
  'chat.delta',
  'chat.conversation',
  'models.updated',
];

const CONVERSACION_KEY = 'centro.chat.conversacion';
const stored = () => {
  try {
    return localStorage.getItem(CONVERSACION_KEY);
  } catch {
    return null;
  }
};

/** Sin eventos ni latidos durante este tiempo, la conexión se considera caída. */
const STALE_MS = 40_000;

/**
 * Conexión con el centro de control: una sola fuente de eventos (SSE). El navegador reconecta solo
 * y manda Last-Event-ID; si la conexión se pierde del todo, se vuelve a abrir pidiendo lo que
 * faltó desde el último evento recibido. El servidor decide si reenvía o manda el estado completo.
 */
export function useCentro(enabled: boolean) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [lastBeat, setLastBeat] = useState<number | null>(null);
  const lastId = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    dispatch({ type: 'conexion', conexion: 'conectando' });

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/eventos${lastId.current ? `?desde=${encodeURIComponent(lastId.current)}` : ''}`);
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (ev) => {
          const m = ev as MessageEvent<string>;
          if (m.lastEventId) lastId.current = m.lastEventId;
          let data: unknown;
          try {
            data = JSON.parse(m.data);
          } catch {
            return;
          }
          dispatch({ type: 'evento', event: { type, data } as ServerEvent, at: Date.now() });
          setLastBeat(Date.now());
        });
      }
      es.addEventListener('latido', () => setLastBeat(Date.now()));
      es.onerror = () => {
        dispatch({ type: 'conexion', conexion: 'reconectando' });
        // CLOSED: el proxy respondió algo que no es un flujo de eventos (servidor apagado). Se reintenta a mano.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();

    const watchdog = setInterval(() => {
      setLastBeat((b) => {
        if (b && Date.now() - b > STALE_MS) {
          dispatch({ type: 'conexion', conexion: 'reconectando' });
          es?.close();
          clearTimeout(retry);
          retry = setTimeout(connect, 500);
          return null;
        }
        return b;
      });
    }, 5000);

    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      clearInterval(watchdog);
      dispatch({ type: 'conexion', conexion: 'apagado' });
    };
  }, [enabled]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Corre una llamada a la API mostrando el error (si lo hay) en la interfaz. */
  const call = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String((e as Error)?.message ?? e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const addMessages = useCallback((messages?: ChatMessage[]) => messages && dispatch({ type: 'chat', messages }), []);

  // Conversación activa: la elegida (recordada en este navegador) o, si ya no existe, la más reciente
  const [elegida, setElegida] = useState<string | null>(stored);
  const conversacion = state.conversaciones.some((c) => c.id === elegida) ? elegida : (state.conversaciones[0]?.id ?? null);
  const selectConversation = useCallback((id: string) => {
    setElegida(id);
    try {
      localStorage.setItem(CONVERSACION_KEY, id);
    } catch {
      /* sin almacenamiento local */
    }
  }, []);
  // fijarla en cuanto se conoce: que otra conversación reciba un mensaje no cambia la que se ve
  useEffect(() => {
    if (conversacion && conversacion !== elegida) selectConversation(conversacion);
  }, [conversacion, elegida, selectConversation]);
  useEffect(() => {
    if (!enabled || !conversacion) return;
    api
      .chatHistory(conversacion)
      .then(addMessages)
      .catch(() => {});
  }, [enabled, conversacion, addMessages]);
  const newConversation = useCallback(
    () =>
      call(api.newConversation).then((c) => {
        if (!c) return;
        dispatch({ type: 'conversacion', conversacion: c });
        selectConversation(c.id);
      }),
    [call, selectConversation],
  );

  const send = useCallback(
    (texto: string, opciones?: Omit<ChatOptions, 'conversacion'>) =>
      call(() => api.chat(texto, { ...opciones, conversacion: conversacion ?? undefined })).then(addMessages),
    [call, addMessages, conversacion],
  );
  const act = useCallback((accion: Action) => call(() => api.action(accion, conversacion ?? undefined)).then(addMessages), [call, addMessages, conversacion]);
  const loadOlderLogs = useCallback((logs: LogEntry[]) => dispatch({ type: 'logs-anteriores', logs }), []);

  return { state, lastBeat, busy, error, setError, call, send, act, loadOlderLogs, conversacion, selectConversation, newConversation };
}

export type Centro = ReturnType<typeof useCentro>;
