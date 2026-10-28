import { normalize } from '@core';
import type { QwenClient } from '../llm/llm';
import { describe as describeJob } from './jobs';
import { ACTIVE, FINISHED, type Action, type ChatBlock, type Job, type LogEntry, type ModelInfo, type RouteUnit } from '@protocol';

// Chat del centro de control. El texto se interpreta como una intención de una lista cerrada; la
// intención se resuelve con datos reales y, si hace falta actuar, con una de las acciones
// permitidas (Action). Ninguna respuesta (ni del modelo) se ejecuta como comando.
//
// 1. Reglas (rápidas, deterministas) para las frases habituales.
// 2. Si ninguna regla aplica: Qwen clasifica la intención con un esquema cerrado; el resultado se
//    valida (intención conocida, ruta y ejecución existentes) antes de usarlo.

export const INTENTS = [
  'ayuda',
  'pendientes',
  'procesadas',
  'fallidas',
  'siguiente',
  'seleccionar',
  'procesar',
  'reintentar',
  'cancelar',
  'pausar',
  'reanudar',
  'cola',
  'qwen',
  'pi',
  'archivos',
  'detalles',
  'explicar',
  'actualizar-fuente',
  'historial',
] as const;
export type Intent = (typeof INTENTS)[number] | 'desconocida';

const n = (s: string) => normalize(s).toLowerCase();

/** Reglas en orden de prioridad (la primera que aplica gana). */
const RULES: [Intent, RegExp][] = [
  ['ayuda', /\b(ayuda|que puedes hacer|que sabes hacer|comandos|como funciona)\b/],
  ['explicar', /\b(explica\w*|resume\w*|resumen)\b.*\b(pi|ejecucion|procesamiento|resultado)\b|\bcon pi\b/],
  ['pi', /\bpi( cli)?\b/],
  ['qwen', /\b(qwen|modelo|la ia)\b/],
  ['cancelar', /\b(cancela\w*|aborta\w*)\b|\bdeten(er)? (la|esa|esta) (ejecucion|tarea|ruta)\b/],
  ['pausar', /\b(pausa\w*)\b|\bdeten(er)? la cola\b/],
  ['reanudar', /\b(reanuda\w*)\b|\b(continua|sigue) con la cola\b/],
  ['reintentar', /\b(reintenta\w*|vuelve a intentar|vuelve a procesar|intentalo de nuevo)\b/],
  ['actualizar-fuente', /\b(actualiza\w*|escanea\w*|detecta\w*|revisa)\b.*\b(fuente|pagina|sitio|rutas nuevas|mapas nuevos)\b/],
  ['seleccionar', /\b(seleccion\w*|elegir|elijo|escoger|escojo|manualmente)\b|\bcual (ruta )?sigue\b/],
  ['siguiente', /\b(procesa|procesar|ejecuta|ejecutar|corre|correr|inicia|iniciar|lanza)\b.*\b(siguiente|proxima|proximo)\b/],
  ['pendientes', /\b(pendientes?|por procesar|sin procesar|faltan)\b/],
  ['fallidas', /\b(fall\w*|errores?|fracas\w*)\b/],
  ['archivos', /\b(archivos?|kml|kmz)\b.*\b(generad\w*|guardad\w*|donde|salida|resultados?)\b|\bdonde se guardaron\b/],
  ['detalles', /\b(detalles?|abre|abrir)\b/],
  ['procesadas', /\b(procesad\w*|procesaron|completad\w*|terminad\w*|listas|correctamente|exitos\w*)\b/],
  ['historial', /\b(historial|ejecuciones anteriores|ultimas ejecuciones)\b/],
  ['cola', /\b(cola|en ejecucion|ejecutando|que esta haciendo|en curso|corriendo|que esta pasando)\b/],
];

const IMPERATIVE = /^(por favor )?(procesa|procesar|ejecuta|ejecutar|corre|correr|inicia|iniciar|encola|encolar|lanza)\b/;

const SMALL_TALK =
  /^((hola+|holi+s?|hey|ey|buen[oa]s?( dias| tardes| noches)?|saludos|que tal|como estas|como te va|gracias|muchas gracias|ok|okay|vale|perfecto|genial|excelente|adios|hasta luego|nos vemos)( (qwen|amigo|a todos|que tal|como estas|de nuevo|otra vez))*)$/;

/** Saludos y cortesías («¡Holaaa!», «gracias»): no piden consultar ni controlar nada. */
export function isSmallTalk(text: string): boolean {
  return SMALL_TALK.test(n(text));
}

export function ruleIntent(text: string, mentionsRoute: boolean): Intent | null {
  const t = n(text);
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  if (IMPERATIVE.test(t) || (mentionsRoute && /\b(procesa|ejecuta|corre)\b/.test(t))) return 'procesar';
  return null;
}

const STOP = new Set([
  'ruta',
  'rutas',
  'sur',
  'oriente',
  'centro',
  'para',
  'esta',
  'este',
  'esa',
  'ese',
  'cual',
  'las',
  'los',
  'del',
  'que',
  'por',
  'con',
  'una',
  'uno',
  'favor',
  'procesa',
  'procesar',
  'ejecuta',
  'muestra',
  'muestrame',
  'detalles',
  'detalle',
  'carpeta',
  'archivos',
  'reintenta',
  'siguiente',
  'ahora',
  'primero',
  'grupo',
  'anexas',
]);

/** Rutas que menciona el texto: slug exacto, "ruta 2" / "ruta 5a", o palabras distintivas (ctm, atlacholoaya). */
export function findRoutes(text: string, units: RouteUnit[]): RouteUnit[] {
  const t = n(text);
  const raw = text.toLowerCase();
  const exact = units.filter((u) => raw.includes(u.slug.toLowerCase()));
  if (exact.length) return exact;
  const lotes = [...new Set(units.map((u) => u.lote))].filter((l) => new RegExp(`\\b${n(l)}\\b`).test(t));
  const pool = lotes.length ? units.filter((u) => lotes.includes(u.lote)) : units;
  const words = t.split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  const slugWords = (u: RouteUnit) => {
    const parts = n(u.slug.replace(/-/g, ' ')).split(' ');
    const singles = parts.filter((p) => p.length === 1).join('');
    return new Set([...parts.filter((p) => p.length >= 3 && !STOP.has(p)), ...(singles.length >= 2 ? [singles] : [])]);
  };
  const num = /\bruta (\d+[a-z]?)\b/.exec(t) ?? /\br(\d+[a-z]?)\b/.exec(t);
  let hits = num ? pool.filter((u) => new RegExp(`^ruta-${num[1]}(-|$)`).test(u.slug.toLowerCase())) : [];
  const byWords = (list: RouteUnit[]) => list.filter((u) => words.some((w) => slugWords(u).has(w)));
  if (hits.length > 1) {
    const narrowed = byWords(hits);
    if (narrowed.length) hits = narrowed;
  }
  if (!num) hits = byWords(pool);
  return hits;
}

const JOB_RE = /\b(j[0-9a-z]{6,12}-[0-9a-f]{6})\b/;

export interface ChatDeps {
  routes(): RouteUnit[];
  jobs(): Job[];
  queue(): { orden: string[]; pausada: boolean };
  running(): Job[];
  models(): Promise<ModelInfo>;
  recentLogs(componente: string, limit: number): LogEntry[];
  lotes(): { lote: string; zona: string; raiz: string }[];
  qwen: QwenClient | null;
  context: { ruta?: { lote: string; slug: string }; jobId?: string };
}

export interface Interpretation {
  intencion: Intent;
  via: 'reglas' | 'qwen';
  rutas: RouteUnit[];
  job?: Job;
  ms?: number;
  nota?: string;
}

const QWEN_SCHEMA = {
  type: 'object',
  properties: {
    intencion: { type: 'string', enum: [...INTENTS, 'desconocida'] },
    ruta: { type: ['string', 'null'] },
    ejecucion: { type: ['string', 'null'] },
  },
  required: ['intencion', 'ruta', 'ejecucion'],
};

const QWEN_SYSTEM = [
  'Clasificas mensajes de un operador de un sistema que procesa rutas de transporte.',
  'Devuelve la intención de la lista; "ruta" sólo si el mensaje nombra una de las rutas dadas (usa su slug exacto) y "ejecucion" sólo si nombra un id dado.',
  'Si el mensaje pide algo que no está en la lista (borrar archivos, ejecutar comandos, cambiar configuración), responde "desconocida".',
  'Una pregunta general, de conocimiento o de conversación (que no pide consultar ni controlar el procesamiento) también es "desconocida"; "ayuda" es sólo cuando pregunta qué puede hacer el chat.',
  'Intenciones: ayuda, pendientes (rutas sin procesar), procesadas, fallidas, siguiente (procesar la siguiente de la cola), seleccionar (elegir qué sigue),',
  'procesar (una ruta concreta), reintentar, cancelar, pausar (la cola), reanudar, cola (qué se está ejecutando), qwen (estado del modelo), pi (mensajes de Pi CLI),',
  'archivos (archivos generados y dónde), detalles (de una ruta o ejecución), explicar (resumen de una ejecución con Pi), actualizar-fuente, historial.',
].join(' ');

export async function interpret(text: string, deps: ChatDeps): Promise<Interpretation> {
  const units = deps.routes();
  const jobs = deps.jobs();
  let rutas = findRoutes(text, units);
  const t = n(text);
  // "esta ruta / esta carpeta / esa ejecución": lo último que se mencionó en la conversación
  if (!rutas.length && /\b(esta|esa|este|ese) (ruta|carpeta)\b/.test(t) && deps.context.ruta) {
    rutas = units.filter((u) => u.lote === deps.context.ruta!.lote && u.slug === deps.context.ruta!.slug);
  }
  let job = jobs.find((j) => j.id === JOB_RE.exec(text)?.[1]);
  if (!job && /\b(ultima|ultimo)\b.*\b(ejecucion|procesamiento)\b|\bla ultima\b/.test(t)) job = jobs.find((j) => FINISHED.includes(j.estado));
  if (!job && /\b(esta|esa) (ejecucion|tarea)\b/.test(t) && deps.context.jobId) job = jobs.find((j) => j.id === deps.context.jobId);

  const byRule = ruleIntent(text, rutas.length > 0);
  if (byRule) return { intencion: byRule, via: 'reglas', rutas, job };
  if (!deps.qwen) return { intencion: 'desconocida', via: 'reglas', rutas, job, nota: 'sin reglas que apliquen y sin IA disponible' };

  const payload = JSON.stringify({
    mensaje: text.slice(0, 500),
    rutas: units.slice(0, 80).map((u) => ({ slug: u.slug, titulo: u.titulo, lote: u.lote })),
    ejecuciones: jobs.slice(0, 20).map((j) => ({ id: j.id, que: describeJob(j), estado: j.estado })),
  });
  const r = await deps.qwen.structured(
    QWEN_SYSTEM,
    payload,
    QWEN_SCHEMA,
    (raw) => {
      const v = raw as { intencion?: string; ruta?: string | null; ejecucion?: string | null };
      if (!v || !([...INTENTS, 'desconocida'] as string[]).includes(String(v.intencion))) throw new Error('intención fuera de la lista');
      return v;
    },
    { origen: 'chat', tarea: 'interpretar un mensaje del chat' },
  );
  if (!r.value) return { intencion: 'desconocida', via: 'qwen', rutas, job, ms: r.ms, nota: r.error };
  const ruta = r.value.ruta ? units.filter((u) => u.slug === r.value!.ruta) : [];
  const j2 = r.value.ejecucion ? jobs.find((x) => x.id === r.value!.ejecucion) : undefined;
  return { intencion: r.value.intencion as Intent, via: 'qwen', rutas: rutas.length ? rutas : ruta, job: job ?? j2, ms: r.ms };
}

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<string, string> = {
  'sin-procesar': 'sin procesar',
  procesada: 'procesada',
  'con-revision': 'procesada, con casos en revisión',
  'con-errores': 'con errores',
  incompleta: 'a medias',
};

export const SUGGESTIONS = [
  'Muéstrame las rutas pendientes de procesar',
  '¿Qué rutas ya se procesaron correctamente?',
  'Procesa la siguiente ruta',
  'Quiero seleccionar manualmente cuál ruta sigue',
  'Muéstrame los archivos que fallaron',
  '¿Qué está haciendo Qwen en este momento?',
  'Muéstrame los últimos mensajes de Pi CLI',
  '¿Qué archivos se generaron y dónde se guardaron?',
];

const unitText = (u: RouteUnit) => `${u.lote} · ${u.titulo || u.slug}`;
const ago = (iso?: string) => {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
};
const jobLine = (j: Job) => ({
  texto: `${describeJob(j)} — ${j.estado.replace(/_/g, ' ').toLowerCase()}`,
  detalle: [
    j.id,
    j.etapa && ACTIVE.includes(j.estado) ? `etapa ${j.etapa}` : '',
    j.resultado ? `${j.resultado.generados} generados, ${j.resultado.revision} en revisión` : '',
    ago(j.finalizadoEn ?? j.iniciadoEn ?? j.creadoEn),
  ]
    .filter(Boolean)
    .join(' · '),
  estado: j.estado,
});

/** Una o varias rutas: si son varias, se ofrecen para elegir. */
function chooseRoute(rutas: RouteUnit[], make: (u: RouteUnit) => { etiqueta: string; accion: Action }, titulo: string): ChatBlock[] {
  return [{ tipo: 'opciones', titulo, opciones: rutas.slice(0, 12).map(make) }];
}

export interface Reply {
  bloques: ChatBlock[];
  /** Acción que el chat debe ejecutar ya (pedida explícitamente por el usuario). */
  ejecutar?: Action;
}

export async function reply(i: Interpretation, deps: ChatDeps): Promise<Reply> {
  const units = deps.routes();
  const jobs = deps.jobs();
  const q = deps.queue();
  const pending = q.orden.map((id) => jobs.find((j) => j.id === id)!).filter(Boolean);
  const running = deps.running();
  const remember = (u?: RouteUnit, j?: Job) => {
    if (u) deps.context.ruta = { lote: u.lote, slug: u.slug };
    if (j) deps.context.jobId = j.id;
  };
  const lotesSinFuente = deps.lotes().filter((l) => !units.some((u) => u.lote === l.lote));

  switch (i.intencion) {
    case 'ayuda':
      return {
        bloques: [
          {
            tipo: 'texto',
            texto:
              'Puedo mostrarte las rutas pendientes o procesadas, procesar la siguiente o la que elijas, reordenar y pausar la cola, reintentar o cancelar ejecuciones, decirte qué archivos se generaron y dónde, qué está haciendo Qwen y qué dijo Pi CLI. No ejecuto comandos del sistema ni toco archivos fuera de los lotes.',
          },
          {
            tipo: 'opciones',
            titulo: 'Para empezar',
            opciones: [
              { etiqueta: 'Procesar la siguiente', accion: { tipo: 'ejecutar-siguiente' } },
              ...deps.lotes().map((l) => ({ etiqueta: `Encolar pendientes de ${l.lote}`, accion: { tipo: 'encolar-pendientes', lote: l.lote } as Action })),
            ],
          },
        ],
      };

    case 'pendientes': {
      const todo = units.filter((u) => u.estado === 'sin-procesar' || u.estado === 'incompleta');
      const bloques: ChatBlock[] = [];
      if (pending.length) bloques.push({ tipo: 'lista', titulo: `En cola (${pending.length})`, items: pending.map(jobLine) });
      bloques.push(
        todo.length
          ? {
              tipo: 'lista',
              titulo: `Rutas sin procesar (${todo.length})`,
              items: todo.map((u) => ({
                texto: unitText(u),
                detalle: `${u.mapas} mapa(s) · ${STATUS_TEXT[u.estado]}${u.jobActivo ? ' · ya en cola' : ''}`,
                estado: u.estado,
              })),
            }
          : { tipo: 'texto', texto: 'No hay rutas sin procesar en los lotes con fuente leída.' },
      );
      if (todo.length)
        bloques.push(
          ...chooseRoute(
            todo.filter((u) => !u.jobActivo),
            (u) => ({ etiqueta: `Procesar ${u.titulo || u.slug}`, accion: { tipo: 'encolar', lote: u.lote, ruta: u.slug, primero: true, iniciar: true } }),
            'Procesar una ahora',
          ),
        );
      for (const l of lotesSinFuente)
        bloques.push({
          tipo: 'opciones',
          titulo: `${l.lote}: todavía no se ha leído la página de la fuente`,
          opciones: [{ etiqueta: `Actualizar fuente de ${l.lote}`, accion: { tipo: 'actualizar-fuente', lote: l.lote } }],
        });
      return { bloques };
    }

    case 'procesadas': {
      const ok = units.filter((u) => u.estado === 'procesada' || u.estado === 'con-revision');
      const done = jobs.filter((j) => j.estado === 'COMPLETADO' || j.estado === 'COMPLETADO_CON_ADVERTENCIAS').slice(0, 10);
      return {
        bloques: [
          ok.length
            ? {
                tipo: 'lista',
                titulo: `Rutas procesadas (${ok.length})`,
                items: ok.map((u) => ({
                  texto: unitText(u),
                  detalle: `${u.conteo.GENERADO ?? 0} mapa(s) generados${u.conteo.REQUIERE_REVISION ? ` · ${u.conteo.REQUIERE_REVISION} con revisión` : ''}${u.conteo.ERROR ? ` · ${u.conteo.ERROR} con error` : ''}`,
                  estado: u.estado,
                })),
              }
            : { tipo: 'texto', texto: 'Todavía no hay rutas procesadas.' },
          ...(done.length ? [{ tipo: 'lista', titulo: 'Últimas ejecuciones terminadas', items: done.map(jobLine) } as ChatBlock] : []),
        ],
      };
    }

    case 'fallidas': {
      const failed = jobs.filter((j) => ['FALLIDO', 'INTERRUMPIDO', 'CANCELADO'].includes(j.estado)).slice(0, 10);
      const withErrors = units.filter((u) => u.estado === 'con-errores');
      const bloques: ChatBlock[] = [];
      bloques.push(
        failed.length
          ? {
              tipo: 'lista',
              titulo: `Ejecuciones fallidas, interrumpidas o canceladas (${failed.length})`,
              items: failed.map((j) => ({ ...jobLine(j), detalle: `${jobLine(j).detalle}${j.errores.length ? ` · ${j.errores[j.errores.length - 1]}` : ''}` })),
            }
          : { tipo: 'texto', texto: 'No hay ejecuciones fallidas.' },
      );
      if (withErrors.length)
        bloques.push({
          tipo: 'lista',
          titulo: 'Rutas con mapas que no se pudieron descargar o leer',
          items: withErrors.map((u) => ({ texto: unitText(u), detalle: `${u.conteo.ERROR} mapa(s) con error`, estado: u.estado })),
        });
      if (failed.length)
        bloques.push({
          tipo: 'opciones',
          titulo: 'Reintentar',
          opciones: failed.slice(0, 6).map((j) => ({
            etiqueta: `Reintentar ${j.unidad.tipo === 'ruta' ? j.unidad.slug : 'fuente'}`,
            accion: { tipo: 'reintentar', jobId: j.id } as Action,
          })),
        });
      return { bloques };
    }

    case 'siguiente': {
      if (pending.length) return { bloques: [], ejecutar: { tipo: 'ejecutar-siguiente' } };
      const todo = units.filter((u) => u.estado === 'sin-procesar' && !u.jobActivo);
      return {
        bloques: [
          { tipo: 'texto', texto: 'La cola está vacía.' },
          ...(todo.length
            ? chooseRoute(
                todo,
                (u) => ({ etiqueta: `Procesar ${u.titulo || u.slug}`, accion: { tipo: 'encolar', lote: u.lote, ruta: u.slug, primero: true, iniciar: true } }),
                'Elige qué ruta procesar',
              )
            : []),
        ],
      };
    }

    case 'seleccionar': {
      const todo = units.filter((u) => !u.jobActivo && u.estado !== 'procesada');
      return {
        bloques: [
          ...(pending.length
            ? [
                {
                  tipo: 'opciones',
                  titulo: 'Pasar al frente de la cola',
                  opciones: pending.map((j) => ({ etiqueta: describeJob(j), accion: { tipo: 'mover-primero', jobId: j.id } as Action })),
                } as ChatBlock,
              ]
            : []),
          ...(todo.length
            ? chooseRoute(
                todo,
                (u) => ({
                  etiqueta: `${u.titulo || u.slug} (${STATUS_TEXT[u.estado]})`,
                  accion: { tipo: 'encolar', lote: u.lote, ruta: u.slug, primero: true },
                }),
                'O agregar una ruta como la siguiente',
              )
            : []),
          ...(!pending.length && !todo.length ? [{ tipo: 'texto', texto: 'No hay nada pendiente que elegir.' } as ChatBlock] : []),
        ],
      };
    }

    case 'procesar': {
      if (i.rutas.length === 1) {
        remember(i.rutas[0]);
        return { bloques: [], ejecutar: { tipo: 'encolar', lote: i.rutas[0].lote, ruta: i.rutas[0].slug, primero: true, iniciar: true } };
      }
      if (i.rutas.length > 1)
        return {
          bloques: chooseRoute(
            i.rutas,
            (u) => ({
              etiqueta: `${unitText(u)} (${STATUS_TEXT[u.estado]})`,
              accion: { tipo: 'encolar', lote: u.lote, ruta: u.slug, primero: true, iniciar: true },
            }),
            'Hay varias rutas que coinciden, ¿cuál?',
          ),
        };
      return {
        bloques: [
          {
            tipo: 'texto',
            texto: 'No encontré esa ruta. Escribe, por ejemplo, «procesa la ruta 2» o «procesa ruta-1-ahuehuetzingo-sur», o pide las pendientes.',
          },
        ],
      };
    }

    case 'reintentar': {
      const candidates = (
        i.job
          ? [i.job]
          : jobs.filter(
              (j) =>
                ['FALLIDO', 'INTERRUMPIDO', 'CANCELADO', 'COMPLETADO_CON_ADVERTENCIAS'].includes(j.estado) &&
                (!i.rutas.length || i.rutas.some((u) => j.unidad.tipo === 'ruta' && j.unidad.slug === u.slug && j.lote === u.lote)),
            )
      ).slice(0, 8);
      if (candidates.length === 1 && FINISHED.includes(candidates[0].estado)) {
        remember(undefined, candidates[0]);
        return { bloques: [], ejecutar: { tipo: 'reintentar', jobId: candidates[0].id } };
      }
      if (!candidates.length && i.rutas.length === 1)
        return { bloques: [{ tipo: 'texto', texto: `${unitText(i.rutas[0])} no tiene ejecuciones fallidas.` }], ejecutar: undefined };
      if (!candidates.length) return { bloques: [{ tipo: 'texto', texto: 'No hay ejecuciones para reintentar.' }] };
      return {
        bloques: [
          {
            tipo: 'opciones',
            titulo: '¿Cuál reintento?',
            opciones: candidates.map((j) => ({
              etiqueta: `${describeJob(j)} (${j.estado.toLowerCase()})`,
              accion: { tipo: 'reintentar', jobId: j.id } as Action,
            })),
          },
        ],
      };
    }

    case 'cancelar': {
      const targets = i.job
        ? [i.job]
        : [...running, ...pending].filter((j) => !i.rutas.length || i.rutas.some((u) => j.unidad.tipo === 'ruta' && j.unidad.slug === u.slug));
      if (!targets.length) return { bloques: [{ tipo: 'texto', texto: 'No hay ejecuciones en curso ni pendientes que cancelar.' }] };
      return {
        bloques: [
          {
            tipo: 'texto',
            texto:
              'Cancelar una pendiente es inmediato. Una en curso se detiene en el siguiente punto seguro (no durante la escritura de resultados); los originales ya descargados se conservan.',
          },
          {
            tipo: 'opciones',
            titulo: 'Confirma qué cancelar',
            opciones: targets.map((j) => ({
              etiqueta: `Cancelar ${describeJob(j)} (${j.estado.toLowerCase()})`,
              accion: { tipo: 'cancelar', jobId: j.id } as Action,
              peligrosa: true,
            })),
          },
        ],
      };
    }

    case 'pausar':
      return { bloques: [], ejecutar: { tipo: 'pausar' } };
    case 'reanudar':
      return { bloques: [], ejecutar: { tipo: 'reanudar' } };

    case 'cola':
      return {
        bloques: [
          running.length
            ? {
                tipo: 'lista',
                titulo: 'En ejecución',
                items: running.map((j) => ({
                  ...jobLine(j),
                  detalle: `${j.etapa ?? 'iniciando'}${j.progreso ? ` · ${j.progreso.hechos}/${j.progreso.total} mapas` : ''} · ${ago(j.iniciadoEn)}`,
                })),
              }
            : { tipo: 'texto', texto: 'No hay nada ejecutándose.' },
          pending.length
            ? { tipo: 'lista', titulo: `En cola${q.pausada ? ' (en pausa)' : ''}`, items: pending.map(jobLine) }
            : { tipo: 'texto', texto: `La cola está vacía${q.pausada ? ' y en pausa' : ''}.` },
          ...running.map((j) => ({ tipo: 'ejecucion', jobId: j.id }) as ChatBlock),
        ],
      };

    case 'qwen': {
      const m = await deps.models();
      const a = m.qwen.actual;
      const u = m.qwen.ultima;
      const texts = [
        a
          ? `Qwen (${m.qwen.modelo}) está ocupado ${ago(a.desde).replace('hace', 'desde hace')}: ${a.tarea} (pedido por ${a.origen}).`
          : `Qwen (${m.qwen.modelo}) no está procesando nada en este momento.`,
        m.qwen.enEspera ? `${m.qwen.enEspera} petición(es) esperan turno.` : '',
        u ? `Última: ${u.tarea} — ${u.ok ? 'bien' : `falló (${u.detalle})`}, ${Math.round(u.ms / 100) / 10} s, ${ago(u.hasta)}.` : '',
        m.qwen.cargados
          ? m.qwen.cargados.length
            ? `Cargado en Ollama: ${m.qwen.cargados.map((c) => `${c.name} (${(c.size / 1e9).toFixed(1)} GB${c.size_vram ? `, ${Math.round((c.size_vram / c.size) * 100)} % en GPU` : ''})`).join(', ')}.`
            : 'Ollama no tiene ningún modelo cargado ahora (se carga en la siguiente petición, ~6 s).'
          : m.qwen.error
            ? `No pude consultar Ollama: ${m.qwen.error}`
            : '',
        'Con salida estructurada y razonamiento desactivado, Ollama no expone pasos intermedios: sólo se ven la tarea, la duración y el resultado validado (en la consola, componente QWEN).',
      ];
      return { bloques: [{ tipo: 'texto', texto: texts.filter(Boolean).join(' ') }] };
    }

    case 'pi': {
      const m = await deps.models();
      const logs = deps.recentLogs('PI-CLI', 15);
      return {
        bloques: [
          {
            tipo: 'texto',
            texto: `${m.pi.detalle}${m.pi.enCurso ? ` Ahora mismo está explicando ${m.pi.enCurso.jobId}.` : ''}${m.pi.ultima ? ` Última ejecución: código ${m.pi.ultima.codigo}, ${Math.round(m.pi.ultima.ms / 1000)} s, ${ago(m.pi.ultima.hasta)}.` : ''}`,
          },
          logs.length
            ? {
                tipo: 'lista',
                titulo: 'Últimos mensajes de Pi CLI',
                items: logs.map((l) => ({ texto: l.mensaje, detalle: `${l.ts.slice(11, 19)} · ${l.nivel}`, estado: l.nivel })),
              }
            : { tipo: 'texto', texto: 'Pi CLI no ha emitido mensajes en esta sesión del servidor.' },
          ...(jobs.find((j) => FINISHED.includes(j.estado))
            ? [
                {
                  tipo: 'opciones',
                  opciones: [
                    {
                      etiqueta: 'Explicar la última ejecución con Pi',
                      accion: { tipo: 'explicar-con-pi', jobId: jobs.find((j) => FINISHED.includes(j.estado))!.id },
                    },
                  ],
                } as ChatBlock,
              ]
            : []),
        ],
      };
    }

    case 'archivos': {
      const job =
        i.job ??
        (i.rutas.length === 1
          ? jobs.find((j) => j.unidad.tipo === 'ruta' && j.unidad.slug === i.rutas[0].slug && j.archivosSalida.length)
          : jobs.find((j) => j.archivosSalida.length));
      if (!job)
        return {
          bloques: [
            {
              tipo: 'texto',
              texto:
                i.rutas.length === 1
                  ? `No hay ejecuciones de ${unitText(i.rutas[0])} con archivos todavía; abre sus detalles para ver lo que hay en disco.`
                  : 'Todavía no hay ejecuciones con archivos generados.',
            },
          ],
          ...(i.rutas.length === 1 && { ejecutar: { tipo: 'detalle-ruta', lote: i.rutas[0].lote, ruta: i.rutas[0].slug } }),
        };
      remember(undefined, job);
      const raiz = deps.lotes().find((l) => l.lote === job.lote)?.raiz ?? '';
      return {
        bloques: [
          {
            tipo: 'texto',
            texto: `${describeJob(job)}: ${job.archivosSalida.filter((f) => f.tipo === 'resultado').length} resultado(s) y ${job.archivosSalida.filter((f) => f.tipo === 'revision').length} copia(s) para revisión, en ${raiz}.`,
          },
          { tipo: 'archivos', lote: job.lote, items: job.archivosSalida.map((f) => ({ rel: f.rel, tipo: f.tipo, detalle: f.estado })) },
        ],
      };
    }

    case 'detalles': {
      if (i.job) {
        remember(undefined, i.job);
        return { bloques: [{ tipo: 'ejecucion', jobId: i.job.id }] };
      }
      if (i.rutas.length === 1) {
        remember(i.rutas[0]);
        return { bloques: [], ejecutar: { tipo: 'detalle-ruta', lote: i.rutas[0].lote, ruta: i.rutas[0].slug } };
      }
      if (i.rutas.length > 1)
        return { bloques: chooseRoute(i.rutas, (u) => ({ etiqueta: unitText(u), accion: { tipo: 'detalle-ruta', lote: u.lote, ruta: u.slug } }), '¿De cuál?') };
      const recent = jobs.slice(0, 6);
      return {
        bloques: [
          {
            tipo: 'opciones',
            titulo: '¿De qué ejecución?',
            opciones: recent.map((j) => ({
              etiqueta: `${describeJob(j)} (${j.estado.toLowerCase()})`,
              accion: { tipo: 'detalle-ejecucion', jobId: j.id } as Action,
            })),
          },
        ],
      };
    }

    case 'explicar': {
      const job =
        i.job ??
        jobs.find(
          (j) =>
            FINISHED.includes(j.estado) &&
            (!i.rutas.length || (j.unidad.tipo === 'ruta' && i.rutas.some((u) => u.slug === (j.unidad as { slug: string }).slug))),
        );
      if (!job) return { bloques: [{ tipo: 'texto', texto: 'No hay ejecuciones terminadas que explicar.' }] };
      return { bloques: [], ejecutar: { tipo: 'explicar-con-pi', jobId: job.id } };
    }

    case 'actualizar-fuente': {
      // primero los lotes cuya fuente nunca se leyó
      const ls = [...lotesSinFuente, ...deps.lotes().filter((l) => !lotesSinFuente.some((x) => x.lote === l.lote))];
      const options = ls.map((l) => ({ etiqueta: `Actualizar fuente de ${l.lote}`, accion: { tipo: 'actualizar-fuente', lote: l.lote } as Action }));
      return { bloques: [{ tipo: 'opciones', titulo: 'Leer de nuevo la página de la zona y sus subpáginas (no descarga mapas)', opciones: options }] };
    }

    case 'historial': {
      const done = jobs.filter((j) => FINISHED.includes(j.estado)).slice(0, 15);
      return {
        bloques: [
          done.length
            ? { tipo: 'lista', titulo: 'Ejecuciones anteriores', items: done.map(jobLine) }
            : { tipo: 'texto', texto: 'Todavía no hay ejecuciones terminadas.' },
        ],
      };
    }

    default:
      return {
        bloques: [
          {
            tipo: 'texto',
            texto: `No entendí qué hacer${i.nota ? ` (${i.nota})` : ''}. Sólo puedo consultar y controlar el procesamiento de rutas; no ejecuto comandos.`,
          },
          { tipo: 'sugerencias', items: SUGGESTIONS },
        ],
      };
  }
}
