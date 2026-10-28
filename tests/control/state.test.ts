import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONVERSACION_ANTERIOR, type ChatMessage, type Job, type LogEntry, type ServerEvent, type Snapshot } from '@protocol';
import { ControlCenter } from '../../src/control/ControlCenter';
import { initialState, MAX_LOGS, reducer, type CenterState } from '../../src/control/state';
import type { Centro } from '../../src/control/useCentro';

const job = (id: string, estado: Job['estado'], extra: Partial<Job> = {}): Job => ({
  id,
  lote: 'SUR',
  unidad: { tipo: 'ruta', slug: 'ruta-2-sur', titulo: 'RUTA 2 SUR' },
  estado,
  etapa: estado.startsWith('EN_') ? 'descarga' : null,
  parametros: { sinRed: false, refrescar: false, sinIa: false },
  creadoEn: '2026-10-24T10:00:00.000Z',
  encoladoEn: '2026-10-24T10:00:00.000Z',
  iniciadoEn: estado === 'PENDIENTE' ? undefined : '2026-10-24T10:00:01.000Z',
  tiempos: {},
  intento: 1,
  archivosEntrada: [],
  archivosSalida: [],
  errores: [],
  advertencias: [],
  origen: 'chat',
  ...extra,
});

const log = (seq: number, mensaje = `m${seq}`): LogEntry => ({ seq, ts: '2026-10-24T10:00:00.000Z', nivel: 'INFO', componente: 'ORCHESTRATOR', mensaje });

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  servidor: { inicio: '2026-10-24T09:00:00.000Z', bootId: 'b1', version: '1' },
  lotes: [{ lote: 'SUR', zona: 'SUR', fuente: 'https://x', raiz: '~/GEODATA/RUTAS_ORQUESTADOR/SUR' }],
  cola: { orden: ['j2'], pausada: false, maxSimultaneas: 1 },
  jobs: [job('j1', 'EN_DESCARGA', { progreso: { etapa: 'descarga', hechos: 3, total: 7 } }), job('j2', 'PENDIENTE')],
  rutas: [{ lote: 'SUR', slug: 'ruta-2-sur', titulo: 'RUTA 2 SUR', mapas: 7, estado: 'con-revision', conteo: { GENERADO: 5, REQUIERE_REVISION: 2 } }],
  logs: [log(1), log(2)],
  conversaciones: [
    { id: CONVERSACION_ANTERIOR, titulo: 'Mensajes anteriores', creadaEn: '2026-10-24T09:00:00.000Z', actualizadaEn: '2026-10-24T10:00:00.000Z', mensajes: 2 },
  ],
  modelos: {
    qwen: {
      modelo: 'qwen3.5:4b',
      url: '',
      actual: { origen: 'orquestador', tarea: 'interpretar «6. ZACATEPEC»', modelo: 'qwen3.5:4b', desde: new Date().toISOString() } as never,
      enEspera: 0,
      ultima: null,
    },
    pi: { disponible: true, detalle: 'Pi 1.4.0', version: '1.4.0', enCurso: null, ultima: null },
  },
  ...over,
});

const ev = (s: CenterState, event: ServerEvent) => reducer(s, { type: 'evento', event, at: 1000 });

describe('estado del centro en el navegador', () => {
  it('se arma con el estado completo y se mantiene con eventos', () => {
    let s = ev(initialState, { type: 'snapshot', data: snapshot() });
    expect(s.conexion).toBe('conectado');
    expect(Object.keys(s.jobs)).toEqual(['j1', 'j2']);
    s = ev(s, { type: 'job.stage_changed', data: job('j1', 'EN_ANALISIS') });
    expect(s.jobs.j1.estado).toBe('EN_ANALISIS');
    s = ev(s, { type: 'job.file_updated', data: { jobId: 'j1', lote: 'SUR', ruta: 'ruta-2-sur', mapa: 'm1', rel: 'originales/m1.kml', estado: 'descargado' } });
    expect(s.archivosVivos).toHaveLength(1);
    const v = s.version.SUR;
    s = ev(s, { type: 'job.completed', data: job('j1', 'COMPLETADO') });
    expect(s.archivosVivos).toHaveLength(0);
    expect(s.version.SUR).toBe(v + 1);
    s = ev(s, { type: 'queue.updated', data: { orden: [], pausada: true, maxSimultaneas: 1 } });
    expect(s.cola.pausada).toBe(true);
  });

  it('tras reconectar, el estado completo reemplaza lo anterior (sin duplicar registros)', () => {
    let s = ev(initialState, { type: 'snapshot', data: snapshot() });
    s = ev(s, { type: 'job.log', data: log(3) });
    s = ev(s, { type: 'job.log', data: log(3) });
    expect(s.logs.map((l) => l.seq)).toEqual([1, 2, 3]);
    s = ev(s, {
      type: 'snapshot',
      data: snapshot({ jobs: [job('j2', 'EN_DESCARGA')], cola: { orden: [], pausada: false, maxSimultaneas: 1 }, logs: [log(2), log(3), log(4)] }),
    });
    expect(Object.keys(s.jobs)).toEqual(['j2']);
    expect(s.logs.map((l) => l.seq)).toEqual([2, 3, 4]);
  });

  it('los mensajes de Pi se van reemplazando por id hasta la versión final', () => {
    const m: ChatMessage = { id: 'x', ts: '2026-10-24T10:00:00.000Z', rol: 'sistema', texto: '', bloques: [{ tipo: 'texto', texto: 'Se ' }], parcial: true };
    let s = ev(initialState, { type: 'chat.message', data: m });
    s = ev(s, { type: 'chat.message', data: { ...m, bloques: [{ tipo: 'texto', texto: 'Se generaron 14' }] } });
    s = ev(s, { type: 'chat.message', data: { ...m, parcial: false, bloques: [{ tipo: 'texto', texto: 'Se generaron 14 archivos.' }] } });
    expect(s.chat).toHaveLength(1);
    expect(s.chat[0]).toMatchObject({ parcial: false, bloques: [{ texto: 'Se generaron 14 archivos.' }] });
  });

  it('una versión vieja de un mensaje en vivo (la respuesta HTTP que llega tarde) no pisa a una más nueva', () => {
    const q: ChatMessage = {
      id: 'q',
      ts: '2026-10-24T10:00:00.000Z',
      rol: 'qwen',
      texto: '',
      bloques: [],
      parcial: true,
      rev: 0,
      qwen: { modelo: 'qwen3.5:4b', pensar: true, fase: 'esperando' },
    };
    let s = ev(initialState, { type: 'chat.message', data: { ...q, rev: 3, texto: 'Hay tres', qwen: { ...q.qwen!, fase: 'respondiendo' } } });
    s = reducer(s, { type: 'chat', messages: [q] });
    expect(s.chat[0]).toMatchObject({ texto: 'Hay tres', rev: 3 });
    s = ev(s, { type: 'chat.message', data: { ...q, rev: 5, parcial: false, texto: 'Hay tres rutas.', qwen: { ...q.qwen!, fase: 'listo' } } });
    s = ev(s, { type: 'chat.message', data: { ...q, rev: 4, texto: 'Hay tres rut' } });
    expect(s.chat[0]).toMatchObject({ parcial: false, texto: 'Hay tres rutas.' });
  });

  it('streaming: los trozos se agregan en orden; si falta uno se ignoran hasta la siguiente versión completa', () => {
    const q: ChatMessage = {
      id: 'q',
      ts: '2026-10-24T10:00:00.000Z',
      rol: 'qwen',
      texto: '',
      bloques: [],
      parcial: true,
      rev: 0,
      qwen: { modelo: 'qwen3.5:4b', pensar: true, fase: 'esperando' },
    };
    let s = ev(initialState, { type: 'chat.message', data: q });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 1, fase: 'pensando', razonamiento: 'Thinking ' } });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 2, razonamiento: 'Process' } });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 3, fase: 'respondiendo', texto: 'El lote ' } });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 4, texto: '**SUR**' } });
    expect(s.chat[0]).toMatchObject({ rev: 4, texto: 'El lote **SUR**', qwen: { fase: 'respondiendo', razonamiento: 'Thinking Process' } });
    // se perdió el 5: el 6 no se aplica; la versión completa (7) pone al día y el 8 sigue
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 6, texto: ' tiene' } });
    expect(s.chat[0].texto).toBe('El lote **SUR**');
    s = ev(s, {
      type: 'chat.message',
      data: { ...q, rev: 7, texto: 'El lote **SUR** tiene 24', qwen: { ...q.qwen!, fase: 'respondiendo', razonamiento: 'Thinking Process' } },
    });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 8, texto: ' rutas.' } });
    expect(s.chat[0].texto).toBe('El lote **SUR** tiene 24 rutas.');
    // un trozo de un mensaje desconocido o ya terminado no hace nada
    s = ev(s, { type: 'chat.message', data: { ...q, rev: 9, parcial: false, texto: 'El lote **SUR** tiene 24 rutas.', qwen: { ...q.qwen!, fase: 'listo' } } });
    s = ev(s, { type: 'chat.delta', data: { id: 'q', rev: 10, texto: ' extra' } });
    s = ev(s, { type: 'chat.delta', data: { id: 'otro', rev: 1, texto: 'x' } });
    expect(s.chat).toHaveLength(1);
    expect(s.chat[0]).toMatchObject({ parcial: false, texto: 'El lote **SUR** tiene 24 rutas.' });
  });

  it('conversaciones: llegan con el estado y por eventos, la más reciente primero', () => {
    let s = ev(initialState, { type: 'snapshot', data: snapshot() });
    expect(s.conversaciones.map((c) => c.id)).toEqual([CONVERSACION_ANTERIOR]);
    s = ev(s, {
      type: 'chat.conversation',
      data: { id: 'c-1', titulo: 'Nuevo chat', creadaEn: '2026-10-25T10:00:00.000Z', actualizadaEn: '2026-10-25T10:00:00.000Z', mensajes: 0 },
    });
    s = ev(s, {
      type: 'chat.conversation',
      data: { id: 'c-1', titulo: '¿Cuántas rutas hay?', creadaEn: '2026-10-25T10:00:00.000Z', actualizadaEn: '2026-10-25T10:01:00.000Z', mensajes: 2 },
    });
    expect(s.conversaciones.map((c) => [c.id, c.titulo])).toEqual([
      ['c-1', '¿Cuántas rutas hay?'],
      [CONVERSACION_ANTERIOR, 'Mensajes anteriores'],
    ]);
  });

  it('si el servidor se reinició, las respuestas que estaban escribiéndose se cierran (no quedan girando)', () => {
    let s = ev(initialState, { type: 'snapshot', data: snapshot() });
    s = ev(s, {
      type: 'chat.message',
      data: {
        id: 'q',
        ts: '2026-10-24T10:00:00.000Z',
        rol: 'qwen',
        texto: 'a medias',
        bloques: [],
        parcial: true,
        qwen: { modelo: 'q', pensar: true, fase: 'respondiendo' },
      },
    });
    s = ev(s, { type: 'snapshot', data: snapshot() });
    expect(s.chat[0].parcial).toBe(true);
    s = ev(s, { type: 'snapshot', data: snapshot({ servidor: { inicio: '2026-10-24T11:00:00.000Z', bootId: 'b2', version: '1' } }) });
    expect(s.chat[0]).toMatchObject({ parcial: false, texto: 'a medias', qwen: { fase: 'error' } });
    expect(s.chat[0].bloques.at(-1)).toMatchObject({ tipo: 'error' });
  });

  it('la consola en memoria tiene límite', () => {
    let s = initialState;
    for (let i = 0; i < MAX_LOGS + 50; i++) s = ev(s, { type: 'job.log', data: log(i) });
    expect(s.logs).toHaveLength(MAX_LOGS);
    expect(s.logs[0].seq).toBe(50);
  });
});

describe('interfaz (render en servidor, sin navegador)', () => {
  const centro = (state: CenterState): Centro =>
    ({
      state,
      lastBeat: Date.now(),
      busy: false,
      error: null,
      setError: () => {},
      call: async () => undefined,
      send: async () => undefined,
      act: async () => undefined,
      loadOlderLogs: () => {},
      conversacion: state.conversaciones[0]?.id ?? null,
      selectConversation: () => {},
      newConversation: async () => undefined,
    }) as unknown as Centro;

  it('conectado: muestra cola, ejecución en curso con su avance real y la actividad de Qwen', () => {
    const s = ev(initialState, { type: 'snapshot', data: snapshot() });
    const html = renderToString(
      createElement(ControlCenter, { centro: centro(s), open: true, onClose: () => {}, onOpenFile: () => {}, onOpenReview: () => {} }),
    );
    expect(html).toMatch(/Centro de control/);
    expect(html).toMatch(/conectado/);
    expect(html).toMatch(/Cola \(1\)/);
    expect(html).toMatch(/En ejecución \(1\)/);
    expect(html.replace(/<!-- -->/g, '')).toMatch(/descarga 3\/7/);
    expect(html).not.toMatch(/\d+ ?%<\/span>/); // sin porcentajes inventados
  });

  it('chat: los mensajes de Qwen muestran su razonamiento, la fase en curso y lo que midió Ollama', () => {
    let s = ev(initialState, { type: 'snapshot', data: snapshot() });
    const base: ChatMessage = {
      id: 'q1',
      ts: '2026-10-24T10:00:00.000Z',
      rol: 'qwen',
      texto: '',
      bloques: [],
      qwen: { modelo: 'qwen3.5:4b', pensar: true, fase: 'pensando', razonamiento: 'El operador pregunta por la cola.' },
      parcial: true,
    };
    s = ev(s, { type: 'chat.message', data: base });
    s = ev(s, {
      type: 'chat.message',
      data: {
        ...base,
        id: 'q2',
        ts: '2026-10-24T10:01:00.000Z',
        parcial: false,
        texto: 'La cola tiene **una ruta** pendiente.\n- <b>RUTA 2</b>',
        qwen: { ...base.qwen!, fase: 'listo', ms: 12_300, cargaMs: 5200, tokens: { entrada: 1800, salida: 410 }, tokPorSeg: 38.5 },
      },
    });
    const html = renderToString(
      createElement(ControlCenter, { centro: centro(s), open: true, onClose: () => {}, onOpenFile: () => {}, onOpenReview: () => {} }),
    ).replace(/<!-- -->/g, '');
    expect(html).toMatch(/Qwen responde/);
    expect(html).toMatch(/＋ Nuevo chat/);
    expect(html).toMatch(/<option value="c-anterior" selected="">Mensajes anteriores · /);
    expect(html).toMatch(/<option value="bajo" selected="">Bajo · hasta 256 tokens<\/option><option value="medio">Medio · hasta 1,024 tokens/);
    expect(html).toMatch(/Razonamiento \(33 caracteres\) — en curso/);
    expect(html).toMatch(/razonando…/);
    expect(html).toMatch(/Detener/);
    expect(html).toMatch(/La cola tiene <strong>una ruta<\/strong> pendiente\./);
    // lo que escribe el modelo nunca se interpreta como HTML
    expect(html).toMatch(/<ul><li>&lt;b&gt;RUTA 2&lt;\/b&gt;<\/li><\/ul>/);
    expect(html).toMatch(/12\.3 s · carga del modelo 5\.2 s · 1,800 tokens de contexto · 410 generados · 38\.5 tok\/s · con razonamiento/);
    // la actividad del modelo que publica el servidor
    expect(html).toMatch(/qwen3\.5:4b: interpretar «6\. ZACATEPEC» \(orquestador\)/);
  });

  it('desconectado: avisa y no aparenta estar activo', () => {
    const s = { ...ev(initialState, { type: 'snapshot', data: snapshot() }), conexion: 'reconectando' as const };
    const html = renderToString(
      createElement(ControlCenter, { centro: centro(s), open: true, onClose: () => {}, onOpenFile: () => {}, onOpenReview: () => {} }),
    );
    expect(html).toMatch(/Sin conexión con el servidor del centro/);
    expect(html).toMatch(/disabled/);
  });

  it('cerrado no pinta nada (el editor queda intacto)', () => {
    expect(
      renderToString(
        createElement(ControlCenter, { centro: centro(initialState), open: false, onClose: () => {}, onOpenFile: () => {}, onOpenReview: () => {} }),
      ),
    ).toBe('');
  });
});
