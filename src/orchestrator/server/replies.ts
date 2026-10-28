import type { QwenClient } from '../llm/llm';
import { CONVERSACION_ANTERIOR, PRESUPUESTO_RAZONAMIENTO, type ChatBlock, type ChatDelta, type ChatMessage, type Esfuerzo } from '@protocol';
import type { ChatDeps, Interpretation } from './chat';
import { newMessage } from './conversations';
import { conversationTurns, historyTurns, stateSummary } from './conversa';
import type { EventHub } from './hub';
import type { LogService } from './logs';
import { sanitizeText } from './sanitize';

/** Límites de una respuesta de Qwen en el chat (4096 tokens caben de sobra). */
export const QWEN_MAX_TEXTO = 20_000;
const QWEN_MAX_RAZONAMIENTO = 40_000;

/** Lo que las respuestas necesitan del centro: publicar un mensaje, leer el historial y los datos del chat. */
interface RepliesHost {
  post: (m: ChatMessage) => ChatMessage;
  history: (limit: number, conversacion: string) => ChatMessage[];
  deps: (conversacion: string) => ChatDeps;
}

/** Las respuestas de Qwen en el chat: van de una en una (cada una lee el historial con la anterior ya terminada). */
export class QwenReplies {
  private tail: Promise<unknown> = Promise.resolve();
  private runs = new Map<string, AbortController>();

  constructor(
    private readonly qwen: QwenClient,
    private readonly hub: EventHub,
    private readonly logs: LogService,
    private readonly host: RepliesHost,
  ) {}

  /** Qwen responde en texto al mensaje `user`, en su conversación. Devuelve el mensaje en curso; el resto llega por eventos. */
  start(user: ChatMessage, interpretation: Interpretation | null, bloques: ChatBlock[], esfuerzo: Esfuerzo): ChatMessage {
    const { qwen } = this;
    const conv = user.conversacion ?? CONVERSACION_ANTERIOR;
    const presupuesto = PRESUPUESTO_RAZONAMIENTO[esfuerzo];
    const pensar = presupuesto > 0;
    const base: ChatMessage = {
      ...newMessage('qwen', '', conv),
      parcial: true,
      rev: 0,
      qwen: { modelo: qwen.modelo, pensar, esfuerzo, presupuesto, fase: 'esperando' },
    };
    const ctrl = new AbortController();
    this.runs.set(base.id, ctrl);
    let rev = 0;
    const clean = (texto: string, razonamiento?: string) => ({
      texto: sanitizeText(texto, QWEN_MAX_TEXTO),
      razonamiento: razonamiento ? sanitizeText(razonamiento, QWEN_MAX_RAZONAMIENTO) : '',
    });
    const view = (m: ChatMessage): ChatMessage => {
      const c = clean(m.texto, m.qwen?.razonamiento);
      return { ...m, rev: ++rev, texto: c.texto, qwen: m.qwen && { ...m.qwen, razonamiento: c.razonamiento || undefined } };
    };
    // En vivo (streaming): sólo lo nuevo (chat.delta), hasta ~25 veces por segundo, y cada 1.5 s la
    // versión completa para quien se conectó a la mitad o perdió un trozo. Ninguno se guarda para
    // reenviar; la versión final sí. Se sanitiza el texto completo y se manda lo que se agregó: si
    // la sanitización cambió algo ya enviado, va la versión completa.
    let live = { texto: '', razonamiento: '', fase: base.qwen!.fase };
    const sent = { ...live };
    let lastFull = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let done = false;
    let started = false;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (done) return;
      const c = clean(live.texto, live.razonamiento);
      if (c.texto === sent.texto && c.razonamiento === sent.razonamiento && live.fase === sent.fase) return;
      if (c.texto.startsWith(sent.texto) && c.razonamiento.startsWith(sent.razonamiento) && Date.now() - lastFull < 1500) {
        const data: ChatDelta = { id: base.id, rev: ++rev };
        if (live.fase !== sent.fase) data.fase = live.fase;
        if (c.texto.length > sent.texto.length) data.texto = c.texto.slice(sent.texto.length);
        if (c.razonamiento.length > sent.razonamiento.length) data.razonamiento = c.razonamiento.slice(sent.razonamiento.length);
        this.hub.publishVolatile({ type: 'chat.delta', data });
      } else {
        lastFull = Date.now();
        this.hub.publishVolatile({
          type: 'chat.message',
          data: { ...base, rev: ++rev, texto: c.texto, qwen: { ...base.qwen!, fase: live.fase, razonamiento: c.razonamiento || undefined } },
        });
      }
      Object.assign(sent, { texto: c.texto, razonamiento: c.razonamiento, fase: live.fase });
    };
    const update = (p: typeof live) => {
      const faseChanged = p.fase !== live.fase;
      live = p;
      if (faseChanged) flush();
      else timer ??= setTimeout(flush, 40);
    };
    const finish = (m: ChatMessage) => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      this.host.post(view(m));
      return true;
    };
    // detenida mientras esperaba turno: se cierra ya (al llegarle el turno, no se consulta al modelo)
    ctrl.signal.addEventListener('abort', () => !started && finish({ ...base, parcial: false, qwen: { ...base.qwen!, fase: 'detenido' } }), { once: true });
    this.hub.publish({ type: 'chat.message', data: base });

    const run = this.tail.then(async () => {
      if (done) return;
      const r = await qwen.converse(
        () => {
          started = true;
          const deps = this.host.deps(conv);
          return conversationTurns({
            text: user.texto,
            interpretation,
            blocks: bloques,
            // sólo los mensajes de esta conversación: una conversación nueva empieza sin historial
            history: historyTurns(this.host.history(60, conv), user.id),
            summary: sanitizeText(stateSummary(deps, qwen.modelo), 8000),
            jobs: deps.jobs(),
          });
        },
        { presupuesto, signal: ctrl.signal },
        (p) => update({ texto: p.texto, razonamiento: p.razonamiento, fase: p.fase }),
      );
      const fin = r.error ? 'error' : r.detenido ? 'detenido' : 'listo';
      const notas: ChatBlock[] = [];
      if (r.error) notas.push({ tipo: 'error', texto: `Qwen: ${r.error}` });
      if (r.motivo === 'length') notas.push({ tipo: 'texto', texto: '— La respuesta llegó al límite de longitud y puede estar cortada.' });
      if (fin === 'listo' && !r.texto) notas.push({ tipo: 'texto', texto: '— Qwen terminó sin escribir una respuesta.' });
      const final = {
        ...base.qwen!,
        fase: fin,
        razonamiento: r.razonamiento || undefined,
        recortado: r.recortado || undefined,
        ms: r.ms,
        cargaMs: r.cargaMs,
        primerTokenMs: r.primerTokenMs,
        tokens: r.tokens,
        tokPorSeg: r.tokPorSeg,
        motivo: r.motivo,
      } as const;
      if (!finish({ ...base, parcial: false, texto: r.texto, bloques: notas, qwen: final })) return;
      const stats = [
        `${(r.ms / 1000).toFixed(1)} s`,
        r.cargaMs && r.cargaMs > 500 ? `carga del modelo ${(r.cargaMs / 1000).toFixed(1)} s` : '',
        r.tokens.salida ? `${r.tokens.salida} tokens generados` : '',
        r.tokPorSeg ? `${r.tokPorSeg} tok/s` : '',
        pensar
          ? `esfuerzo ${esfuerzo}: razonamiento ${r.razonamiento.length} caracteres${r.recortado ? `, recortado a ${presupuesto} tokens` : ''}`
          : 'sin razonamiento',
      ]
        .filter(Boolean)
        .join(', ');
      this.logs.add({
        nivel: r.error ? 'WARN' : 'INFO',
        componente: 'QWEN',
        mensaje: r.error
          ? `Chat: Qwen falló al responder «${user.texto.slice(0, 80)}»: ${r.error}`
          : r.detenido
            ? `Chat: respuesta de Qwen detenida (${stats})`
            : `Chat: Qwen respondió a «${user.texto.slice(0, 80)}» (${stats})`,
        duracionMs: r.ms,
        datos: { tokens: r.tokens, motivo: r.motivo, esfuerzo, recortado: r.recortado, conversacion: conv },
      });
    });
    this.tail = run
      .catch((e) =>
        finish({ ...base, parcial: false, bloques: [{ tipo: 'error', texto: `Qwen: ${(e as Error).message}` }], qwen: { ...base.qwen!, fase: 'error' } }),
      )
      .finally(() => this.runs.delete(base.id));
    return base;
  }

  /** Detiene una respuesta de Qwen del chat (o todas): lo ya escrito se conserva. */
  stop(id?: string): number {
    let n = 0;
    for (const [k, c] of this.runs) {
      if (id && k !== id) continue;
      c.abort();
      n++;
    }
    return n;
  }
}
