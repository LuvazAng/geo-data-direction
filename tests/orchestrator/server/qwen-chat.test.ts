import { mkdirSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../../../src/control/state';
import { QwenClient } from '../../../src/orchestrator/llm/llm';
import { Center } from '../../../src/orchestrator/server/center';
import { isSmallTalk } from '../../../src/orchestrator/server/chat';
import { CONVERSA_SYSTEM, historyTurns, stateSummary } from '../../../src/orchestrator/server/conversa';
import { EventHub } from '../../../src/orchestrator/server/hub';
import { CONVERSACION_ANTERIOR, type ChatDelta, type ChatMessage, type Esfuerzo, type ServerEvent, type Snapshot } from '@protocol';
import { ollamaStream, tmp } from '../../helpers';
import { centerConfig, controllableRunner, testLote, waitFor } from './helpers';

const DONE = {
  message: { content: '' },
  done: true,
  done_reason: 'stop',
  load_duration: 1_000_000,
  prompt_eval_count: 1500,
  eval_count: 60,
  eval_duration: 1_500_000_000,
};

type Body = { format?: unknown; stream?: boolean; think?: boolean; messages: { role: string; content: string }[] };

/** Ollama simulado: clasifica (format) como «desconocida» y conversa en streaming; con `hang`, la conversación no termina sola. */
function setup() {
  const work = tmp('centro-qwen-');
  const lotes = [testLote(work, 'SUR')];
  const bodies: Body[] = [];
  const opts = { hang: false, words: false };
  const fetchImpl = async (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    bodies.push(body);
    if (body.format) return new Response(JSON.stringify({ message: { content: JSON.stringify({ intencion: 'desconocida', ruta: null, ejecucion: null }) } }));
    if (opts.hang) return ollamaStream([{ message: { content: 'Empiezo a ' } }], { hang: true, signal: init.signal });
    if (opts.words)
      return ollamaStream(
        [
          ...['Cuento ', 'las rutas.'].map((thinking) => ({ message: { content: '', thinking } })),
          ...['Hay', ' **24**', ' rutas', ' en', ' SUR.'].map((content) => ({ message: { content } })),
          DONE,
        ],
        { delayMs: 70 },
      );
    return ollamaStream([{ message: { content: '', thinking: 'Reviso el estado.' } }, { message: { content: 'Respuesta de prueba.' } }, DONE]);
  };
  const qwen = new QwenClient(lotes[0].config.ia, new Map() as never, fetchImpl);
  const center = new Center(centerConfig(join(work, '_centro')), lotes, { runner: controllableRunner().runner, qwen, watch: false, heartbeatMs: 0 });
  const final = async (m: ChatMessage) => {
    await waitFor(() => center.history().some((x) => x.id === m.id && !x.parcial), 3000);
    return center.history().find((x) => x.id === m.id)!;
  };
  const chats = () => bodies.filter((b) => b.stream);
  return { center, bodies, chats, opts, final, work };
}

describe('Qwen conversa en el chat del centro', () => {
  it('a cada mensaje: respuesta del centro y, después, la de Qwen con su razonamiento, sabiendo lo que el centro hizo', async () => {
    const { center, chats, final, work } = setup();
    const out = await center.chat('Muéstrame las rutas pendientes de procesar');
    expect(out.map((m) => m.rol)).toEqual(['usuario', 'sistema', 'qwen']);
    expect(out[2]).toMatchObject({ parcial: true, qwen: { fase: 'esperando', pensar: true, modelo: 'qwen3.5:4b' } });
    const q = await final(out[2]);
    expect(q).toMatchObject({
      rol: 'qwen',
      parcial: false,
      texto: 'Respuesta de prueba.',
      qwen: { fase: 'listo', razonamiento: 'Reviso el estado.', tokens: { entrada: 1500, salida: 60 }, tokPorSeg: 40 },
    });

    const [body] = chats();
    expect(body.think).toBe(true);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain(CONVERSA_SYSTEM);
    expect(body.messages[0].content).toMatch(
      /ESTADO ACTUAL DEL CENTRO[\s\S]*SUR \(zona SUR\): 3 rutas[\s\S]*Rutas de SUR por estado:[\s\S]*Sin procesar \(1\): RUTA-3-SUR \(2 mapa\(s\)[\s\S]*Procesadas por completo \(1\): RUTA-1-SUR\./,
    );
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^Muéstrame las rutas pendientes de procesar/);
    expect(last.content).toMatch(/LO QUE EL CENTRO RESPONDIÓ[\s\S]*intención «pendientes», por reglas[\s\S]*Rutas sin procesar/);
    // sin rutas del equipo
    expect(JSON.stringify(body)).not.toContain(work.replace(/\\/g, '\\\\'));
    expect(center.logs.query({ componente: ['QWEN'] }).some((l) => /Qwen respondió a «Muéstrame/.test(l.mensaje))).toBe(true);
  });

  it('lo que el centro no reconoce lo contesta sólo Qwen (sin el «no entendí»); el historial llega a la siguiente pregunta', async () => {
    const { center, chats, final } = setup();
    const first = await center.chat('¿Qué es una ruta de transporte?');
    expect(first.map((m) => m.rol)).toEqual(['usuario', 'qwen']);
    await final(first[1]);
    const second = await center.chat('¿y cuántas hay en SUR?', { esfuerzo: 'ninguno' });
    await final(second[second.length - 1]);
    const body = chats()[1];
    expect(body.think).toBe(false);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.messages[1].content).toBe('¿Qué es una ruta de transporte?');
    expect(body.messages[2].content).toBe('Respuesta de prueba.');
    // el centro no respondió nada: no se le cuenta a Qwen lo que no pasó
    expect(body.messages[3].content).toBe('¿y cuántas hay en SUR?');
  });

  it('con «Qwen responde» apagado el chat funciona como antes (sin consultar al modelo para conversar)', async () => {
    const { center, chats } = setup();
    const out = await center.chat('Muéstrame las rutas pendientes de procesar', { conversar: false });
    expect(out.map((m) => m.rol)).toEqual(['usuario', 'sistema']);
    expect(chats()).toHaveLength(0);
  });

  it('detener: la que está escribiendo conserva lo escrito; la que espera turno se cierra ya, sin consultar al modelo', async () => {
    const { center, chats, opts, final } = setup();
    opts.hang = true;
    const a = (await center.chat('Muéstrame las rutas pendientes de procesar')).pop()!;
    const b = (await center.chat('¿Qué rutas ya se procesaron correctamente?')).pop()!;
    await waitFor(() => chats().length === 1);
    expect(center.stopQwen(b.id)).toBe(1);
    expect(await final(b)).toMatchObject({ parcial: false, qwen: { fase: 'detenido' } });
    expect(center.stopQwen(a.id)).toBe(1);
    expect(await final(a)).toMatchObject({ parcial: false, texto: 'Empiezo a', qwen: { fase: 'detenido' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(chats()).toHaveLength(1);
    expect(center.stopQwen()).toBe(0);
  });
});

describe('conversaciones y esfuerzo', () => {
  it('cada conversación tiene su historial: una nueva empieza sin mensajes anteriores para Qwen', async () => {
    const { center, chats, final } = setup();
    const a = center.conversation().id;
    await final((await center.chat('¿Qué es una ruta de transporte?', { conversacion: a })).pop()!);
    const b = center.createConversation();
    expect(b.id).not.toBe(a);
    expect(center.createConversation().id).toBe(b.id); // la vacía se reutiliza: no se acumulan vacías
    await final((await center.chat('¿Y cuántas hay en SUR?', { conversacion: b.id })).pop()!);
    expect(chats()[1].messages.map((m) => m.role)).toEqual(['system', 'user']);
    // la nueva toma título de su primer mensaje y queda como la más reciente
    expect(center.conversationList()[0]).toMatchObject({ id: b.id, titulo: '¿Y cuántas hay en SUR?', mensajes: 2 });
    expect(center.history(50, a).map((m) => m.texto)).toEqual(['¿Qué es una ruta de transporte?', 'Respuesta de prueba.']);
    // de vuelta en la primera: relee sólo la primera
    await final((await center.chat('¿Y en ORIENTE?', { conversacion: a })).pop()!);
    expect(chats()[2].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(chats()[2].messages[1].content).toBe('¿Qué es una ruta de transporte?');
    await expect(center.chat('hola', { conversacion: 'c-no-existe' })).rejects.toThrow(/No existe esa conversación/);
  });

  it('los mensajes de antes de que hubiera conversaciones quedan en «Mensajes anteriores»', () => {
    const work = tmp('centro-viejo-');
    const datos = join(work, '_centro');
    mkdirSync(datos, { recursive: true });
    writeFileSync(join(datos, 'chat.jsonl'), `${JSON.stringify({ id: 'm1', ts: '2026-10-24T10:00:00.000Z', rol: 'usuario', texto: 'hola', bloques: [] })}\n`);
    const center = new Center(centerConfig(datos), [testLote(work, 'SUR')], { runner: controllableRunner().runner, qwen: null, watch: false, heartbeatMs: 0 });
    expect(center.conversationList()).toMatchObject([{ id: CONVERSACION_ANTERIOR, titulo: 'Mensajes anteriores', mensajes: 1 }]);
    expect(center.history(10, CONVERSACION_ANTERIOR).map((m) => m.id)).toEqual(['m1']);
  });

  it('un saludo lo contesta sólo Qwen: sin clasificador ni menú del centro', async () => {
    const { center, bodies, chats, final } = setup();
    const out = await center.chat('¡Holaaa!');
    expect(out.map((m) => m.rol)).toEqual(['usuario', 'qwen']);
    await final(out[1]);
    expect(bodies.some((b) => b.format)).toBe(false);
    expect(chats()[0].messages.at(-1)!.content).toBe('¡Holaaa!');
    expect(isSmallTalk('Buenas tardes, Qwen')).toBe(true);
    expect(isSmallTalk('gracias!!')).toBe(true);
    expect(isSmallTalk('hola, procesa la ruta 2')).toBe(false);
  });

  it('el esfuerzo fija el presupuesto de razonamiento (bajo por omisión)', async () => {
    const { center, chats, final } = setup();
    const ask = async (esfuerzo?: Esfuerzo) => (await final((await center.chat('¡hola!', { esfuerzo })).pop()!)).qwen!;
    expect(await ask()).toMatchObject({ esfuerzo: 'bajo', presupuesto: 256, pensar: true, fase: 'listo' });
    expect(await ask('ninguno')).toMatchObject({ esfuerzo: 'ninguno', presupuesto: 0, pensar: false });
    expect(await ask('alto')).toMatchObject({ esfuerzo: 'alto', presupuesto: 3072 });
    expect(chats().map((b) => [b.think, (b as { options?: { num_predict?: number } }).options?.num_predict])).toEqual([
      [true, 256 + 1536],
      [false, 1536],
      [true, 3072 + 1536],
    ]);
  });
});

describe('streaming de las respuestas de Qwen', () => {
  it('manda sólo lo nuevo, palabra por palabra, sin guardarlo para reenviar; el navegador arma el mismo texto', async () => {
    const { center, final, opts } = setup();
    opts.words = true;
    const events: (ServerEvent & { volatil: boolean })[] = [];
    const publish = center.hub.publish.bind(center.hub);
    const volatile = center.hub.publishVolatile.bind(center.hub);
    center.hub.publish = (e) => (events.push({ ...e, volatil: false } as never), publish(e));
    center.hub.publishVolatile = (e) => (events.push({ ...e, volatil: true } as never), volatile(e));
    const out = await center.chat('¿Cuántas rutas hay en SUR?');
    const q = await final(out[out.length - 1]);
    expect(q.texto).toBe('Hay **24** rutas en SUR.');
    const mine = events.filter((e) => (e.data as { id?: string }).id === q.id);
    // para reenviar a quien se reconecta sólo se guardan la versión inicial y la final
    expect(mine.filter((e) => !e.volatil).map((e) => (e.data as ChatMessage).parcial)).toEqual([true, false]);
    const texts = mine
      .filter((e) => e.type === 'chat.delta')
      .map((e) => (e.data as ChatDelta).texto)
      .filter(Boolean);
    expect(texts).toEqual(['Hay', ' **24**', ' rutas', ' en', ' SUR.']);
    // el navegador, con los mismos eventos, tiene el texto completo antes de que llegue la versión final
    let s = initialState;
    for (const e of mine.slice(0, -1)) s = reducer(s, { type: 'evento', event: e, at: 0 });
    expect(s.chat[0]).toMatchObject({ parcial: true, texto: 'Hay **24** rutas en SUR.', qwen: { fase: 'respondiendo', razonamiento: 'Cuento las rutas.' } });
    s = reducer(s, { type: 'evento', event: mine[mine.length - 1], at: 0 });
    expect(s.chat[0]).toMatchObject({ parcial: false, qwen: { fase: 'listo' } });
  });

  it('los trozos no llevan id ni se reenvían al reconectar', () => {
    const hub = new EventHub(() => ({}) as Snapshot, 10, 0);
    const client = () => {
      const writes: string[] = [];
      return { writes, res: { writeHead() {}, write: (s: string) => writes.push(s), on() {} } as unknown as ServerResponse };
    };
    const a = client();
    hub.attach(a.res, undefined);
    hub.publish({ type: 'queue.updated', data: { orden: [], pausada: false, maxSimultaneas: 1 } });
    hub.publishVolatile({ type: 'chat.delta', data: { id: 'q', rev: 1, texto: 'Hola' } });
    expect(a.writes.at(-1)).toBe('event: chat.delta\ndata: {"id":"q","rev":1,"texto":"Hola"}\n\n');
    const b = client();
    expect(hub.attach(b.res, `${hub.bootId}:0`)).toBe('reenvio');
    expect(b.writes.join('')).toContain('queue.updated');
    expect(b.writes.join('')).not.toContain('chat.delta');
  });
});

describe('contexto de la conversación', () => {
  it('resume lotes (también los que no tienen fuente leída), cola y ejecuciones; sólo historial terminado', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      lote: 'ORIENTE',
      slug: `ruta-${i}-oriente`,
      titulo: `RUTA ${i} ORIENTE`,
      mapas: 2,
      estado: 'procesada' as const,
      conteo: { GENERADO: 2 },
    }));
    const summary = stateSummary(
      {
        // un lote grande primero no deja fuera las rutas de otro lote
        routes: () => [
          ...many,
          { lote: 'SUR', slug: 'ruta-2-sur', titulo: 'RUTA 2', mapas: 7, estado: 'con-revision', conteo: { GENERADO: 5, REQUIERE_REVISION: 2 } },
        ],
        jobs: () => [],
        queue: () => ({ orden: [], pausada: true }),
        running: () => [],
        lotes: () => [
          { lote: 'ORIENTE', zona: 'ORIENTE', raiz: '' },
          { lote: 'SUR', zona: 'SUR', raiz: '' },
          { lote: 'NORTE', zona: 'NORTE', raiz: '' },
        ],
      },
      'qwen3.5:4b',
    );
    expect(summary).toMatch(/SUR \(zona SUR\): 1 rutas, 7 mapas — 0 procesadas, 1 con casos en revisión/);
    expect(summary).toMatch(/ORIENTE \(zona ORIENTE\): 70 rutas/);
    expect(summary).toMatch(/Procesadas por completo \(70\): RUTA 0 ORIENTE; .*RUTA 59 ORIENTE; … y 10 más\./);
    expect(summary).toMatch(/Rutas de SUR por estado:\n- Procesadas, con casos en revisión \(1\): RUTA 2 \(7 mapa\(s\): 5 generado, 2 requiere revision\)\./);
    expect(summary).toMatch(/NORTE.*todavía no se ha leído/);
    expect(summary).toMatch(/Cola: vacía \(en pausa\)/);

    const m = (id: string, rol: ChatMessage['rol'], texto: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      id,
      ts: '',
      rol,
      texto,
      bloques: [],
      ...extra,
    });
    const turns = historyTurns(
      [
        m('1', 'usuario', 'hola'),
        m('2', 'sistema', 'lista'),
        m('3', 'qwen', 'Hola, ¿en qué te ayudo?', { qwen: { modelo: 'q', pensar: true, fase: 'listo' } }),
        m('4', 'usuario', '▸ Pausar la cola', { interpretacion: { intencion: 'pausar', via: 'boton' } }),
        m('5', 'qwen', 'a medias', { qwen: { modelo: 'q', pensar: true, fase: 'detenido' } }),
        m('6', 'usuario', 'pregunta actual'),
      ],
      '6',
    );
    expect(turns).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
      { role: 'user', content: '(pulsé un botón) Pausar la cola' },
    ]);
  });
});
