import type { ConverseTurn } from '../llm/llm';
import type { ChatDeps, Interpretation } from './chat';
import { describe as describeJob } from './jobs';
import { ACTIVE, FINISHED, type ChatBlock, type ChatMessage, type Job, type RouteUnit } from '@protocol';

// Conversación con Qwen en el chat del centro. Cada mensaje escrito recibe, además de la respuesta
// del centro (datos reales y acciones validadas), una respuesta en texto de Qwen. Qwen recibe un
// resumen del estado (sin coordenadas ni rutas del equipo), el historial reciente y lo que el
// centro ya respondió o hizo. Lo que escribe es sólo texto para leer: nunca se ejecuta ni se
// convierte en acción.

export const CONVERSA_SYSTEM = [
  'Eres Qwen, el asistente del centro de control que procesa las rutas de transporte público de Morelos (México).',
  'El sistema lee la página de Movilidad de cada zona (lote), descarga los mapas de My Maps (KML) de cada ruta, separa los trazos, identifica origen, destino y sentido, y genera un KML por itinerario con nombres como R2S-JOJU-TETEL; lo dudoso queda «en revisión» para una persona.',
  'Hablas con el operador en español, breve y claro: normalmente de una a cinco frases o una lista corta.',
  'Para preguntas sobre el sistema usa sólo los datos de «ESTADO ACTUAL» y de «LO QUE EL CENTRO RESPONDIÓ»; si un dato no está ahí, dilo en lugar de inventarlo. No inventes cifras, rutas, archivos ni ejecuciones.',
  'El operador ya ve en pantalla lo que respondió el centro: compleméntalo o explícalo con tus palabras, sin copiarlo.',
  'Tú no ejecutas acciones: el centro sólo actúa con frases que reconoce o con botones, y lo que hizo aparece en «LO QUE EL CENTRO RESPONDIÓ». Nunca digas que hiciste algo.',
  'Si el operador pide una acción que el centro no hizo, sugiérele la frase o el botón (por ejemplo «procesa la ruta 2», «procesa la siguiente», «pausa la cola», «reintenta la última»). Si no pide una acción, no hables de acciones ni de comandos.',
  'Si la pregunta no es sobre el sistema, respóndela con tu conocimiento general y aclara que no viene de los datos del centro.',
  'No cierres cada respuesta con una pregunta o un ofrecimiento.',
].join(' ');

const GROUP_ORDER: RouteUnit['estado'][] = ['con-errores', 'con-revision', 'incompleta', 'sin-procesar', 'procesada'];
const GROUP_TEXT: Record<RouteUnit['estado'], string> = {
  'con-errores': 'Con mapas que no se pudieron descargar o leer',
  'con-revision': 'Procesadas, con casos en revisión',
  incompleta: 'A medias',
  'sin-procesar': 'Sin procesar',
  procesada: 'Procesadas por completo',
};

const MAX_RUTAS_GRUPO = 60;
const MAX_SUMMARY = 7000;
const MAX_BLOCKS = 3000;
const MAX_TURN = 1500;
const HISTORY_TURNS = 8;

const ago = (iso: string | undefined, now: number) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60
    ? `hace ${s} s`
    : s < 3600
      ? `hace ${Math.round(s / 60)} min`
      : s < 172_800
        ? `hace ${Math.round(s / 3600)} h`
        : `hace ${Math.round(s / 86_400)} días`;
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

const conteo = (u: RouteUnit) =>
  Object.entries(u.conteo)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`)
    .join(', ');

const jobResult = (j: Job) =>
  j.resultado
    ? `${j.resultado.mapas} mapas, ${j.resultado.generados} generados, ${j.resultado.revision} en revisión${j.resultado.mapasConError ? `, ${j.resultado.mapasConError} mapas con error` : ''}`
    : '';

/** Resumen del estado del centro para Qwen: lotes, rutas, cola, lo que corre y lo último que terminó. */
export function stateSummary(deps: Pick<ChatDeps, 'routes' | 'jobs' | 'queue' | 'running' | 'lotes'>, modelo: string, now = Date.now()): string {
  const units = deps.routes();
  const jobs = deps.jobs();
  const q = deps.queue();
  const running = deps.running();
  const lines: string[] = [`Fecha y hora: ${new Date(now).toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })}.`, '', 'Lotes:'];
  for (const l of deps.lotes()) {
    const mine = units.filter((u) => u.lote === l.lote);
    if (!mine.length) {
      lines.push(`- ${l.lote} (zona ${l.zona}): la página de la fuente todavía no se ha leído; no se conocen sus rutas.`);
      continue;
    }
    const by = (e: string) => mine.filter((u) => u.estado === e).length;
    lines.push(
      `- ${l.lote} (zona ${l.zona}): ${mine.length} rutas, ${mine.reduce((a, u) => a + u.mapas, 0)} mapas — ${by('procesada')} procesadas, ${by('con-revision')} con casos en revisión, ${by('con-errores')} con errores, ${by('incompleta')} a medias, ${by('sin-procesar')} sin procesar.`,
    );
  }
  // rutas de cada lote agrupadas por estado: de las terminadas sólo el nombre; del resto, sus mapas
  for (const l of deps.lotes()) {
    const mine = units.filter((u) => u.lote === l.lote);
    if (!mine.length) continue;
    lines.push('', `Rutas de ${l.lote} por estado:`);
    for (const estado of GROUP_ORDER) {
      const us = mine.filter((u) => u.estado === estado);
      if (!us.length) continue;
      const shown = us.slice(0, MAX_RUTAS_GRUPO).map((u) => {
        const c = conteo(u);
        const busy = u.jobActivo ? ', con una ejecución en cola o en curso' : '';
        return estado === 'procesada' && !busy ? u.titulo || u.slug : `${u.titulo || u.slug} (${u.mapas} mapa(s)${c ? `: ${c}` : ''}${busy})`;
      });
      lines.push(`- ${GROUP_TEXT[estado]} (${us.length}): ${shown.join('; ')}${us.length > shown.length ? `; … y ${us.length - shown.length} más` : ''}.`);
    }
  }
  const pending = q.orden.map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => !!j);
  lines.push(
    '',
    pending.length
      ? `Cola: ${pending.length} pendiente(s)${q.pausada ? ' (la cola está en pausa)' : ''}: ${pending
          .slice(0, 10)
          .map((j, i) => `${i + 1}) ${describeJob(j)}`)
          .join('; ')}${pending.length > 10 ? '; …' : ''}.`
      : `Cola: vacía${q.pausada ? ' (en pausa)' : ''}.`,
  );
  lines.push(
    running.length
      ? `En ejecución: ${running.map((j) => `${describeJob(j)} (id ${j.id}) — etapa ${j.etapa ?? 'iniciando'}${j.progreso ? `, ${j.progreso.hechos}/${j.progreso.total} mapas` : ''}, empezó ${ago(j.iniciadoEn, now)}`).join('; ')}.`
      : 'En ejecución: nada.',
  );
  const done = jobs.filter((j) => FINISHED.includes(j.estado)).slice(0, 8);
  if (done.length) {
    lines.push('', 'Últimas ejecuciones terminadas (la más reciente primero):');
    for (const j of done) {
      const r = jobResult(j);
      lines.push(
        `- ${describeJob(j)} (id ${j.id}): ${j.estado.toLowerCase().replace(/_/g, ' ')}${r ? `; ${r}` : ''}; ${ago(j.finalizadoEn ?? j.iniciadoEn, now)}${j.errores.length ? `; error: ${clip(j.errores[j.errores.length - 1], 200)}` : ''}`,
      );
    }
  }
  lines.push('', `Modelo: tú eres ${modelo}, corriendo en local con Ollama; las consultas al modelo (procesamiento, chat y Pi CLI) van de una en una.`);
  return clip(lines.join('\n'), MAX_SUMMARY);
}

/** Lo que el centro respondió o hizo, en texto (lo que el operador ve en pantalla). */
export function blocksText(blocks: ChatBlock[], jobs: Job[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.tipo) {
      case 'texto':
        out.push(b.texto);
        break;
      case 'error':
        out.push(`Error: ${b.texto}`);
        break;
      case 'lista':
        if (b.titulo) out.push(`${b.titulo}:`);
        for (const it of b.items.slice(0, 15)) out.push(`- ${it.texto}${it.detalle ? ` (${it.detalle})` : ''}`);
        if (b.items.length > 15) out.push(`- … y ${b.items.length - 15} más`);
        break;
      case 'opciones':
        out.push(
          `Botones ofrecidos${b.titulo ? ` («${b.titulo}»)` : ''}: ${b.opciones
            .slice(0, 12)
            .map((o) => o.etiqueta)
            .join('; ')}`,
        );
        break;
      case 'ejecucion': {
        const j = jobs.find((x) => x.id === b.jobId);
        out.push(
          j
            ? `Tarjeta de la ejecución ${describeJob(j)} (id ${j.id}): ${j.estado.toLowerCase().replace(/_/g, ' ')}${ACTIVE.includes(j.estado) && j.etapa ? `, etapa ${j.etapa}` : ''}${jobResult(j) ? `; ${jobResult(j)}` : ''}`
            : `Tarjeta de la ejecución ${b.jobId}`,
        );
        break;
      }
      case 'archivos':
        out.push(
          `Lista de ${b.items.length} archivo(s) de ${b.lote}: ${b.items
            .slice(0, 10)
            .map((f) => `${f.rel} (${f.tipo})`)
            .join(', ')}${b.items.length > 10 ? ', …' : ''}`,
        );
        break;
      case 'sugerencias':
        out.push(`Frases sugeridas: ${b.items.join('; ')}`);
        break;
      case 'ruta':
        out.push(`Enlace a las carpetas y archivos de ${b.lote} · ${b.ruta}`);
        break;
    }
  }
  return clip(out.join('\n'), MAX_BLOCKS);
}

/** Historial reciente (mensajes del operador y respuestas terminadas de Qwen) anterior a `beforeId`. */
export function historyTurns(history: ChatMessage[], beforeId: string): ConverseTurn[] {
  const idx = history.findIndex((m) => m.id === beforeId);
  const prior = idx >= 0 ? history.slice(0, idx) : history;
  const turns: ConverseTurn[] = [];
  for (const m of prior) {
    if (m.rol === 'usuario' && m.texto)
      turns.push({ role: 'user', content: clip(m.interpretacion?.via === 'boton' ? `(pulsé un botón) ${m.texto.replace(/^▸\s*/, '')}` : m.texto, MAX_TURN) });
    else if (m.rol === 'qwen' && !m.parcial && m.texto && m.qwen?.fase === 'listo') turns.push({ role: 'assistant', content: clip(m.texto, MAX_TURN) });
  }
  return turns.slice(-HISTORY_TURNS);
}

/** Mensajes que recibe Qwen: instrucciones + estado, historial y el mensaje con lo que el centro hizo. */
export function conversationTurns(input: {
  text: string;
  interpretation: Interpretation | null;
  blocks: ChatBlock[];
  history: ConverseTurn[];
  summary: string;
  jobs: Job[];
}): ConverseTurn[] {
  const i = input.interpretation;
  // si el centro no respondió nada, no se menciona (el modelo pequeño tiende a comentar lo que no pasó)
  const did = input.blocks.length
    ? `\n\n---\nLO QUE EL CENTRO RESPONDIÓ A ESTE MENSAJE (intención «${i?.intencion ?? 'desconocida'}», ${i?.via === 'qwen' ? 'clasificada por Qwen' : 'por reglas'}):\n${blocksText(input.blocks, input.jobs)}`
    : '';
  return [
    { role: 'system', content: `${CONVERSA_SYSTEM}\n\nESTADO ACTUAL DEL CENTRO\n${input.summary}` },
    ...input.history,
    { role: 'user', content: `${input.text}${did}` },
  ];
}
