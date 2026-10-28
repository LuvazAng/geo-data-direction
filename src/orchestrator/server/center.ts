import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { modelStatus, QwenClient } from '../llm/llm';
import { Workspace } from '../io/store';
import type { Report } from '../pipeline/report';
import { actionLabel, validateAction } from './actions';
import { interpret, isSmallTalk, reply, type ChatDeps, type Interpretation } from './chat';
import { type CenterConfig } from './config';
import { Conversations, newMessage } from './conversations';
import { piPrompt } from './explica';
import type { LoteInfo } from '../config';
import { EventHub } from './hub';
import { ActionError } from '../errors';
import { describe, JobManager, type JobRunner } from './jobs';
import { LogService } from './logs';
import { CenterStore } from './persist';
import { PiService } from './pi';
import { QWEN_MAX_TEXTO, QwenReplies } from './replies';
import {
  ACTIVE,
  ESFUERZOS,
  FINISHED,
  type Action,
  type ChatBlock,
  type ChatMessage,
  type ChatOptions,
  type Conversacion,
  type Esfuerzo,
  type ModelInfo,
  type RouteUnit,
  type Snapshot,
} from '@protocol';
import { sanitizeText } from './sanitize';
import { loteData, routeUnits } from './views';
import { watchLotes } from './watcher';
import { folderOf } from '../domain/naming';

export const VERSION = '1.0.0';

export class Center {
  readonly store: CenterStore;
  readonly hub: EventHub;
  readonly logs: LogService;
  readonly jobs: JobManager;
  readonly pi: PiService;
  readonly qwen: QwenClient | null;
  readonly started = new Date().toISOString();
  private routesCache = new Map<string, RouteUnit[]>();
  /** «Esta ruta», «esa ejecución»: lo último que se mencionó en cada conversación. */
  private chatContexts = new Map<string, ChatDeps['context']>();
  private conversations: Conversations;
  private replies: QwenReplies | null = null;
  private watchers: FSWatcher[] = [];
  private modelTimer?: NodeJS.Timeout;
  private lastModels = '';

  constructor(
    readonly cfg: CenterConfig,
    readonly lotes: LoteInfo[],
    opts: { runner: JobRunner; qwen?: QwenClient | null; watch?: boolean; heartbeatMs?: number },
  ) {
    this.store = new CenterStore(cfg.datos, cfg.retencion);
    this.hub = new EventHub(() => this.snapshot(), cfg.retencion.eventos, opts.heartbeatMs);
    this.conversations = new Conversations(this.store, this.hub, cfg.retencion.chat);
    this.logs = new LogService(this.store, this.hub, cfg.retencion.logsMemoria);
    const ia = lotes[0]?.config.ia;
    this.qwen = opts.qwen !== undefined ? opts.qwen : ia ? new QwenClient(ia, new Map() as never) : null;
    if (this.qwen)
      this.replies = new QwenReplies(this.qwen, this.hub, this.logs, {
        post: (m) => this.post(m),
        history: (n, c) => this.history(n, c),
        deps: (c) => this.deps(c),
      });
    this.pi = new PiService(cfg.pi, ia?.modelo ?? 'qwen3.5:4b', this.logs, join(cfg.datos, 'pi-trabajo'));
    this.jobs = new JobManager({
      store: this.store,
      hub: this.hub,
      logs: this.logs,
      runner: opts.runner,
      lotes,
      maxSimultaneas: cfg.maxSimultaneas,
      onRoutesChanged: (l) => this.refreshRoutes(l),
    });
    if (opts.watch !== false)
      this.watchers = watchLotes(lotes, { jobs: this.jobs, logs: this.logs, hub: this.hub, refreshRoutes: (l) => this.refreshRoutes(l) });
    // El estado del modelo cambia dentro del proceso: se publica cuando cambia (no hay sondeo desde el navegador)
    this.modelTimer = setInterval(() => {
      const s = JSON.stringify({ a: modelStatus.actual, e: modelStatus.enEspera, u: modelStatus.ultima?.hasta, p: this.pi.status().enCurso });
      if (s !== this.lastModels) {
        this.lastModels = s;
        void this.models(false).then((m) => this.hub.publish({ type: 'models.updated', data: m }));
      }
    }, 1000);
    this.modelTimer.unref();
  }

  start() {
    this.logs.add({
      nivel: 'INFO',
      componente: 'BACKEND',
      mensaje: `Centro de control ${VERSION} iniciado: ${this.lotes.map((l) => l.lote).join(', ') || 'sin lotes'}; cola ${this.jobs.queueState().pausada ? 'en pausa' : 'activa'}`,
    });
    if (this.cfg.autoIniciar) this.jobs.pump();
  }

  // ------------------------------------------------------------------ estado

  routes(lote?: string): RouteUnit[] {
    const ls = lote ? this.lotes.filter((l) => l.lote === lote) : this.lotes;
    return ls.flatMap((l) => this.routesCache.get(l.lote) ?? this.computeRoutes(l));
  }

  private computeRoutes(l: LoteInfo) {
    let r: RouteUnit[] = [];
    try {
      r = routeUnits(l, this.jobs?.list() ?? []);
    } catch (e) {
      this.logs.add({ nivel: 'ERROR', componente: 'FS', mensaje: `No se pudo leer el estado de ${l.lote}: ${(e as Error).message}`, lote: l.lote });
    }
    this.routesCache.set(l.lote, r);
    return r;
  }

  refreshRoutes(lote: string) {
    const l = this.lotes.find((x) => x.lote === lote);
    if (!l) return;
    this.computeRoutes(l);
    this.hub.publish({ type: 'routes.updated', data: this.routes() });
  }

  async models(withRuntime = true): Promise<ModelInfo> {
    const ia = this.lotes[0]?.config.ia;
    const info: ModelInfo = {
      qwen: { modelo: ia?.modelo ?? '—', url: ia?.url ?? '—', actual: modelStatus.actual, enEspera: modelStatus.enEspera, ultima: modelStatus.ultima },
      pi: this.pi.status(),
    };
    if (withRuntime && this.qwen) {
      try {
        info.qwen.cargados = await Promise.race([
          this.qwen.loaded(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sin respuesta en 3 s')), 3000)),
        ]);
      } catch (e) {
        info.qwen.error = (e as Error).message;
      }
    }
    return info;
  }

  snapshot(): Snapshot {
    const jobs = this.jobs.list();
    const recent = [
      ...jobs.filter((j) => j.estado === 'PENDIENTE' || ACTIVE.includes(j.estado)),
      ...jobs.filter((j) => FINISHED.includes(j.estado)).slice(0, 100),
    ];
    return {
      servidor: { inicio: this.started, bootId: this.hub.bootId, version: VERSION },
      lotes: this.lotes.map((l) => ({ lote: l.lote, zona: l.zona, fuente: l.fuente, raiz: sanitizeText(l.raiz, 500) })),
      cola: this.jobs.queueState(),
      jobs: recent,
      rutas: this.routes(),
      logs: this.logs.recent(400),
      modelos: {
        qwen: {
          modelo: this.lotes[0]?.config.ia.modelo ?? '—',
          url: this.lotes[0]?.config.ia.url ?? '—',
          actual: modelStatus.actual,
          enEspera: modelStatus.enEspera,
          ultima: modelStatus.ultima,
        },
        pi: this.pi.status(),
      },
      conversaciones: this.conversationList(),
    };
  }

  jobReport(id: string): Report | null {
    const j = this.jobs.get(id);
    const l = this.jobs.lote(j.lote);
    return new Workspace(l.config.dirs.trabajo, l.config.lote).readJson<Report | null>(['ejecuciones', j.id, 'reporte.json'], null);
  }

  // ------------------------------------------------------------------ conversaciones

  /** La más reciente primero. */
  conversationList(): Conversacion[] {
    return this.conversations.list();
  }

  /** Conversación nueva (sin historial para Qwen). Si ya hay una vacía se usa esa: no se acumulan vacías. */
  createConversation(): Conversacion {
    return this.conversations.create();
  }

  /** La conversación indicada (debe existir) o, si no se indicó, la más reciente. */
  conversation(id?: unknown): Conversacion {
    return this.conversations.get(id);
  }

  private contextOf(conversacion: string): ChatDeps['context'] {
    let c = this.chatContexts.get(conversacion);
    if (!c) this.chatContexts.set(conversacion, (c = {}));
    return c;
  }

  // ------------------------------------------------------------------ chat y acciones

  history(limit?: number, conversacion?: string): ChatMessage[] {
    return this.store.loadChat(limit, conversacion);
  }

  private post(m: ChatMessage) {
    const clean: ChatMessage = { ...m, texto: sanitizeText(m.texto, m.rol === 'qwen' ? QWEN_MAX_TEXTO : undefined) };
    if (!m.parcial) {
      this.store.appendChat(clean);
      this.conversations.touch(clean);
    }
    this.hub.publish({ type: 'chat.message', data: clean });
    return clean;
  }

  private deps(conversacion: string): ChatDeps {
    return {
      routes: () => this.routes(),
      jobs: () => this.jobs.list(),
      queue: () => this.jobs.queueState(),
      running: () => this.jobs.runningJobs(),
      models: () => this.models(),
      recentLogs: (c, n) => this.logs.query({ componente: [c as never], limite: n }),
      lotes: () => this.lotes.map((l) => ({ lote: l.lote, zona: l.zona, raiz: sanitizeText(l.raiz, 500) })),
      qwen: this.qwen,
      context: this.contextOf(conversacion),
    };
  }

  /**
   * Mensaje escrito: el centro lo interpreta y responde con datos reales (y, si se pidió, una acción
   * permitida). Con `conversar`, Qwen además responde en texto; esa respuesta llega después, en vivo.
   */
  async chat(texto: string, opciones: ChatOptions = {}): Promise<ChatMessage[]> {
    const text = sanitizeText(String(texto ?? ''), 1000).trim();
    if (!text) throw new ActionError('Mensaje vacío', 400);
    const conv = this.conversation(opciones.conversacion).id;
    const conversar = opciones.conversar !== false && !!this.qwen;
    const esfuerzo: Esfuerzo = ESFUERZOS.includes(opciones.esfuerzo as Esfuerzo) ? (opciones.esfuerzo as Esfuerzo) : 'bajo';
    const user = this.post(newMessage('usuario', text, conv));
    const out = [user];
    // un saludo no pide consultar ni controlar nada: si Qwen conversa, contesta sólo él
    if (conversar && isSmallTalk(text)) {
      this.logs.add({ nivel: 'INFO', componente: 'BACKEND', mensaje: `Chat: «${text.slice(0, 120)}» → saludo (reglas): responde Qwen` });
      out.push(this.replies!.start(user, null, [], esfuerzo));
      return out;
    }
    let answer: ChatMessage | null = null;
    let interpretation: Interpretation | null = null;
    try {
      const i = await interpret(text, this.deps(conv));
      interpretation = i;
      this.logs.add({
        nivel: 'INFO',
        componente: i.via === 'qwen' ? 'QWEN' : 'BACKEND',
        mensaje: `Chat: «${text.slice(0, 120)}» → ${i.intencion} (${i.via}${i.ms ? `, ${i.ms} ms` : ''})${i.nota ? ` — ${i.nota}` : ''}`,
        duracionMs: i.ms,
      });
      const r = await reply(i, this.deps(conv));
      const bloques = [...r.bloques];
      if (r.ejecutar) bloques.push(...(await this.runAction(r.ejecutar, conv)));
      // si Qwen va a conversar, el «no entendí qué hacer» del centro sobra: contesta Qwen
      if (!(conversar && i.intencion === 'desconocida')) answer = newMessage('sistema', '', conv, bloques, { intencion: i.intencion, via: i.via, ms: i.ms });
    } catch (e) {
      answer = newMessage('sistema', '', conv, [{ tipo: 'error', texto: (e as Error).message }]);
    }
    if (answer) out.push(this.post(answer));
    if (conversar) out.push(this.replies!.start(user, interpretation, answer?.bloques ?? [], esfuerzo));
    return out;
  }

  /** Detiene una respuesta de Qwen del chat (o todas): lo ya escrito se conserva. */
  stopQwen(id?: string): number {
    return this.replies?.stop(id) ?? 0;
  }

  /** Acción explícita (botón o API), en la conversación indicada. Se valida forma, permisos y existencia antes de ejecutar. */
  async action(raw: unknown, conversacion?: unknown): Promise<ChatMessage[]> {
    const conv = this.conversation(conversacion).id;
    const a = validateAction(
      raw,
      this.lotes,
      (lote, ruta) => this.routes(lote).some((u) => u.slug === ruta),
      (id) => {
        try {
          return !!this.jobs.get(id);
        } catch {
          return false;
        }
      },
    );
    const user = this.post(newMessage('usuario', `▸ ${actionLabel(a, this.jobs)}`, conv, [], { intencion: a.tipo, via: 'boton' }));
    let bloques: ChatBlock[];
    try {
      bloques = await this.runAction(a, conv);
    } catch (e) {
      bloques = [{ tipo: 'error', texto: (e as Error).message }];
    }
    return [user, this.post(newMessage('sistema', '', conv, bloques, { intencion: a.tipo, via: 'boton' }))];
  }

  async runAction(a: Action, conversacion = this.conversation().id): Promise<ChatBlock[]> {
    const routeTitle = (lote: string, slug: string) => this.routes(lote).find((u) => u.slug === slug)?.titulo ?? slug;
    const context = this.contextOf(conversacion);
    try {
      switch (a.tipo) {
        case 'encolar': {
          if (!this.routes(a.lote).some((u) => u.slug === a.ruta)) throw new ActionError(`La ruta ${a.ruta} no existe en ${a.lote}`, 400);
          const before = this.jobs.queueState().orden.length;
          const { job, creado } = this.jobs.enqueue(
            a.lote,
            { tipo: 'ruta', slug: a.ruta, titulo: routeTitle(a.lote, a.ruta) },
            { primero: a.primero, iniciar: a.iniciar, origen: 'chat' },
          );
          context.jobId = job.id;
          context.ruta = { lote: a.lote, slug: a.ruta };
          const where = ACTIVE.includes(job.estado)
            ? 'ya se está ejecutando'
            : job.estado === 'PENDIENTE'
              ? `está en la cola (posición ${this.jobs.queueState().orden.indexOf(job.id) + 1} de ${Math.max(before, this.jobs.queueState().orden.length)})`
              : job.estado.toLowerCase();
          return [
            {
              tipo: 'texto',
              texto: creado
                ? `${describe(job)}: ${ACTIVE.includes(job.estado) ? 'iniciada' : `agregada; ${where}`}.`
                : `${describe(job)} ${where}; no se duplicó.`,
            },
            { tipo: 'ejecucion', jobId: job.id },
          ];
        }
        case 'encolar-pendientes': {
          const todo = this.routes(a.lote).filter((u) => (u.estado === 'sin-procesar' || u.estado === 'incompleta') && !u.jobActivo);
          if (!this.routes(a.lote).length)
            return [
              { tipo: 'texto', texto: `${a.lote} todavía no tiene la fuente leída.` },
              { tipo: 'opciones', opciones: [{ etiqueta: `Actualizar fuente de ${a.lote}`, accion: { tipo: 'actualizar-fuente', lote: a.lote } }] },
            ];
          for (const u of todo) this.jobs.enqueue(a.lote, { tipo: 'ruta', slug: u.slug, titulo: u.titulo }, { origen: 'chat' });
          return [
            {
              tipo: 'texto',
              texto: todo.length
                ? `Encolé ${todo.length} ruta(s) pendiente(s) de ${a.lote}${this.jobs.queueState().pausada ? '; la cola está en pausa' : ''}.`
                : `No hay rutas pendientes en ${a.lote} sin ejecución en cola.`,
            },
          ];
        }
        case 'actualizar-fuente': {
          const { job, creado } = this.jobs.enqueue(a.lote, { tipo: 'fuente' }, { primero: true, iniciar: true, origen: 'chat' });
          return [
            {
              tipo: 'texto',
              texto: creado
                ? `Leyendo la fuente de ${a.lote} (página de la zona y subpáginas; no descarga mapas).`
                : `Ya hay una lectura de la fuente de ${a.lote} ${job.estado === 'PENDIENTE' ? 'en cola' : 'en curso'}.`,
            },
            { tipo: 'ejecucion', jobId: job.id },
          ];
        }
        case 'mover-primero':
          this.jobs.moveFirst(a.jobId);
          return [
            {
              tipo: 'texto',
              texto: `${describe(this.jobs.get(a.jobId))} es la siguiente en la cola${this.jobs.queueState().pausada ? ' (la cola está en pausa: usa «procesar la siguiente» para correrla ya)' : ''}.`,
            },
          ];
        case 'iniciar': {
          const r = this.jobs.start(a.jobId);
          return [
            {
              tipo: 'texto',
              texto:
                r === 'iniciada'
                  ? `Inicié ${describe(this.jobs.get(a.jobId))}.`
                  : `Hay otra ejecución en curso del mismo lote o sin capacidad: ${describe(this.jobs.get(a.jobId))} queda al frente y empezará al terminar.`,
            },
            { tipo: 'ejecucion', jobId: a.jobId },
          ];
        }
        case 'ejecutar-siguiente': {
          const j = this.jobs.runNext();
          if (!j) return [{ tipo: 'texto', texto: 'No hay ejecuciones pendientes en la cola.' }];
          context.jobId = j.id;
          return [
            { tipo: 'texto', texto: `Inicié la siguiente: ${describe(j)}.` },
            { tipo: 'ejecucion', jobId: j.id },
          ];
        }
        case 'reintentar': {
          const j = this.jobs.retry(a.jobId);
          context.jobId = j.id;
          return [
            {
              tipo: 'texto',
              texto: `Reintento como ejecución nueva (${j.id}, intento ${j.intento}): empieza desde el principio, sin volver a descargar lo que ya está. ${j.estado === 'PENDIENTE' ? 'Quedó al frente de la cola.' : ''}`,
            },
            { tipo: 'ejecucion', jobId: j.id },
          ];
        }
        case 'cancelar': {
          const r = this.jobs.cancel(a.jobId);
          return [
            {
              tipo: 'texto',
              texto:
                r === 'cancelada'
                  ? `Cancelé ${describe(this.jobs.get(a.jobId))} (no había empezado).`
                  : `Pedí cancelar ${describe(this.jobs.get(a.jobId))}: se detendrá en el siguiente punto seguro.`,
            },
            { tipo: 'ejecucion', jobId: a.jobId },
          ];
        }
        case 'pausar':
          this.jobs.pause();
          return [
            {
              tipo: 'texto',
              texto: `Cola en pausa: no se tomarán ejecuciones nuevas${this.jobs.runningJobs().length ? '; la que está en curso termina normalmente' : ''}. «Procesar la siguiente» sigue funcionando a mano.`,
            },
          ];
        case 'reanudar':
          this.jobs.resume();
          return [
            {
              tipo: 'texto',
              texto: `Cola reanudada${this.jobs.queueState().orden.length ? `: ${this.jobs.queueState().orden.length} pendiente(s)` : ' (está vacía)'}.`,
            },
          ];
        case 'detalle-ejecucion':
          context.jobId = a.jobId;
          return [{ tipo: 'ejecucion', jobId: a.jobId }];
        case 'detalle-ruta': {
          const u = this.routes(a.lote).find((x) => x.slug === a.ruta);
          if (!u) throw new ActionError(`La ruta ${a.ruta} no existe en ${a.lote}`, 400);
          context.ruta = { lote: a.lote, slug: a.ruta };
          const conteo = Object.entries(u.conteo)
            .map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`)
            .join(', ');
          return [
            {
              tipo: 'texto',
              texto: `${u.lote} · ${u.titulo}: ${u.mapas} mapa(s) — ${conteo}. Carpeta de resultados: ${a.lote}/resultados/${loteData(this.jobs.lote(a.lote)).scan ? `${this.jobs.lote(a.lote).zona}/${folderOf(a.ruta)}` : '—'}.`,
            },
            { tipo: 'ruta', lote: a.lote, ruta: a.ruta },
            ...(u.jobActivo || u.ultimoJob ? [{ tipo: 'ejecucion', jobId: (u.jobActivo ?? u.ultimoJob)! } as ChatBlock] : []),
            ...(!u.jobActivo
              ? [
                  {
                    tipo: 'opciones',
                    opciones: [
                      { etiqueta: `Procesar ${u.titulo}`, accion: { tipo: 'encolar', lote: a.lote, ruta: a.ruta, primero: true, iniciar: true } as Action },
                    ],
                  } as ChatBlock,
                ]
              : []),
          ];
        }
        case 'explicar-con-pi':
          return this.explain(a.jobId, conversacion);
      }
    } catch (e) {
      if (e instanceof ActionError) return [{ tipo: 'error', texto: e.message }];
      throw e;
    }
  }

  /** Pi redacta un resumen de la ejecución; el texto llega al chat a medida que Pi lo escribe. */
  private explain(jobId: string, conversacion: string): ChatBlock[] {
    const j = this.jobs.get(jobId);
    if (!FINISHED.includes(j.estado)) throw new ActionError('Sólo se pueden explicar ejecuciones terminadas');
    if (this.pi.busy) throw new ActionError('Pi ya está explicando otra ejecución; espera a que termine');
    const prompt = piPrompt(j, this.jobReport(j.id));
    const msg = newMessage('sistema', '', conversacion, [{ tipo: 'texto', texto: 'Pi CLI está preparando la explicación…' }]);
    msg.parcial = true;
    const t0 = Date.now();
    this.hub.publish({ type: 'chat.message', data: msg });
    void this.pi
      .run(j.id, prompt, (t) =>
        this.hub.publish({ type: 'chat.message', data: { ...msg, parcial: true, bloques: [{ tipo: 'texto', texto: sanitizeText(t) }] } }),
      )
      .then((r) =>
        this.post({
          ...msg,
          parcial: false,
          bloques: r.ok
            ? [
                { tipo: 'texto', texto: r.texto },
                {
                  tipo: 'texto',
                  texto: `— Pi CLI · ${this.lotes[0]?.config.ia.modelo} · ${Math.round(r.ms / 1000)} s${r.cortado ? ' · Pi cortó la respuesta al llegar a su límite de longitud' : ''}. Es una redacción del modelo: las cifras exactas están en el detalle de la ejecución.`,
                },
              ]
            : [{ tipo: 'error', texto: `Pi terminó con código ${r.codigo} sin respuesta (ver consola, componente PI-CLI).` }],
        }),
      )
      .catch((e) =>
        this.post({ ...msg, parcial: false, bloques: [{ tipo: 'error', texto: `Pi: ${(e as Error).message} (${Math.round((Date.now() - t0) / 1000)} s)` }] }),
      );
    return [
      {
        tipo: 'texto',
        texto: `Le pedí a Pi CLI que explique ${describe(j)}. Su salida real aparece en la consola (PI-CLI); suele tardar entre 20 y 60 s porque el modelo razona antes de responder.`,
      },
    ];
  }

  async close() {
    if (this.modelTimer) clearInterval(this.modelTimer);
    for (const w of this.watchers) w.close();
    this.pi.cancel();
    this.stopQwen();
    await this.jobs.shutdown();
    this.hub.close();
  }
}
