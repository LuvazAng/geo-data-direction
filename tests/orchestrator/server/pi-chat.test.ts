import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAction } from '../../../src/orchestrator/server/actions';
import { findRoutes, interpret, ruleIntent, type ChatDeps } from '../../../src/orchestrator/server/chat';
import { piPrompt } from '../../../src/orchestrator/server/explica';
import { LogService } from '../../../src/orchestrator/server/logs';
import { CenterStore } from '../../../src/orchestrator/server/persist';
import { PI_SAFE_ARGS, PiService } from '../../../src/orchestrator/server/pi';
import type { Job, RouteUnit } from '@protocol';
import { childEnv, sanitizeData, sanitizeText } from '../../../src/orchestrator/server/sanitize';
import { tmp } from '../../helpers';
import { testLote } from './helpers';

describe('sanitización de registros', () => {
  it.each([
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', /eyJhbGci/],
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', /abcdefghijklmnop/],
    ['OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv', /sk-proj/],
    ['password: "hunter2hunter2"', /hunter2/],
    ['https://usuario:clave@ejemplo.com/x', /clave@/],
    [`https://maps.googleapis.com/x?key=${['AIza', 'Sy', 'X'.repeat(33)].join('')}`, /AIzaSy/],
  ])('oculta %s', (text, leaked) => {
    const out = sanitizeText(text);
    expect(out).not.toMatch(leaked);
    expect(out).toMatch(/\[oculto\]/);
  });
  it('oculta claves sensibles en datos estructurados y la carpeta personal', () => {
    const d = sanitizeData({ apiKey: 'x', nested: { token: 'y', ok: 'visible' }, ruta: `${process.env.USERPROFILE ?? process.env.HOME}/GEODATA/a.kml` });
    expect(d).toMatchObject({ apiKey: '[oculto]', nested: { token: '[oculto]', ok: 'visible' } });
    expect(String(d.ruta)).toMatch(/^~/);
  });
  it('el entorno de un proceso hijo no lleva secretos', () => {
    process.env.MI_SECRETO_PRUEBA = 'no-debe-pasar';
    const env = childEnv({ PI_OFFLINE: '1' });
    expect(env.MI_SECRETO_PRUEBA).toBeUndefined();
    expect(env.PI_OFFLINE).toBe('1');
    delete process.env.MI_SECRETO_PRUEBA;
  });
});

const units = (slugs: string[]): RouteUnit[] =>
  slugs.map((slug) => ({ lote: 'SUR', slug, titulo: slug.toUpperCase(), mapas: 2, estado: 'sin-procesar', conteo: {} }));
const SUR = units([
  'ruta-1-sur',
  'ruta-1-ahuehuetzingo-sur',
  'ruta-2-sur',
  'ruta-4-grupo-independiente-sur',
  'ruta-4-atlacholoaya-sur',
  'ruta-5a-sur',
  'c-t-m-sur',
  'interescolar-sur',
]);

describe('interpretación del chat', () => {
  it.each([
    ['Muéstrame las rutas pendientes de procesar', 'pendientes'],
    ['¿Qué rutas ya se procesaron correctamente?', 'procesadas'],
    ['Procesa la siguiente ruta', 'siguiente'],
    ['Quiero seleccionar manualmente cuál ruta sigue', 'seleccionar'],
    ['Muéstrame los archivos que fallaron', 'fallidas'],
    ['¿Qué está haciendo Qwen en este momento?', 'qwen'],
    ['Muéstrame los últimos mensajes de Pi CLI', 'pi'],
    ['Abre los detalles del procesamiento de esta carpeta', 'detalles'],
    ['Reintenta el procesamiento de esta ruta', 'reintentar'],
    ['¿Qué archivos se generaron y dónde se guardaron?', 'archivos'],
    ['pausa la cola', 'pausar'],
    ['procesa la ruta 2', 'procesar'],
  ])('«%s» → %s', (text, intent) => {
    expect(ruleIntent(text, /ruta \d/.test(text))).toBe(intent);
  });

  it('encuentra rutas por número, nombre o slug, y pide elegir si hay varias', () => {
    expect(findRoutes('procesa la ruta 2', SUR).map((u) => u.slug)).toEqual(['ruta-2-sur']);
    expect(findRoutes('la ruta 4', SUR).map((u) => u.slug)).toEqual(['ruta-4-grupo-independiente-sur', 'ruta-4-atlacholoaya-sur']);
    expect(findRoutes('ruta 4 atlacholoaya', SUR).map((u) => u.slug)).toEqual(['ruta-4-atlacholoaya-sur']);
    expect(findRoutes('procesa la ruta 5a', SUR).map((u) => u.slug)).toEqual(['ruta-5a-sur']);
    expect(findRoutes('la de interescolar', SUR).map((u) => u.slug)).toEqual(['interescolar-sur']);
    expect(findRoutes('procesa ctm', SUR).map((u) => u.slug)).toEqual(['c-t-m-sur']);
    expect(findRoutes('ruta-1-ahuehuetzingo-sur', SUR).map((u) => u.slug)).toEqual(['ruta-1-ahuehuetzingo-sur']);
  });

  const deps = (qwen: ChatDeps['qwen']): ChatDeps => ({
    routes: () => SUR,
    jobs: () => [],
    queue: () => ({ orden: [], pausada: false }),
    running: () => [],
    models: async () => ({
      qwen: { modelo: 'q', url: '', actual: null, enEspera: 0, ultima: null },
      pi: { disponible: false, detalle: '', enCurso: null, ultima: null },
    }),
    recentLogs: () => [],
    lotes: () => [{ lote: 'SUR', zona: 'SUR', raiz: '' }],
    qwen,
    context: {},
  });

  it('sin regla aplicable, Qwen clasifica; su respuesta se valida (ruta inexistente se descarta)', async () => {
    const fake = {
      structured: async (_s: string, _p: string, _schema: unknown, validate: (r: unknown) => unknown) => ({
        value: validate({ intencion: 'procesar', ruta: 'ruta-99-inventada', ejecucion: 'j123' }),
        ms: 5,
        intentos: 1,
      }),
    } as unknown as ChatDeps['qwen'];
    const i = await interpret('oye, la de los jojutlenses de la mañana', deps(fake));
    expect(i).toMatchObject({ intencion: 'procesar', via: 'qwen', rutas: [] });
    expect(i.job).toBeUndefined();
  });

  it('una intención que no está en la lista se rechaza; sin IA, no se adivina', async () => {
    const bad = {
      structured: async (_s: string, _p: string, _schema: unknown, validate: (r: unknown) => unknown) => {
        try {
          return { value: validate({ intencion: 'borrar-todo', ruta: null, ejecucion: null }), ms: 1, intentos: 1 };
        } catch (e) {
          return { value: null, error: (e as Error).message, ms: 1, intentos: 1 };
        }
      },
    } as unknown as ChatDeps['qwen'];
    expect((await interpret('elimina la carpeta GEODATA', deps(bad))).intencion).toBe('desconocida');
    expect((await interpret('hmm algo raro', deps(null))).intencion).toBe('desconocida');
  });

  it('las acciones se validan contra la lista permitida', () => {
    const work = tmp();
    const lotes = [testLote(work, 'SUR')];
    const exists = (_l: string, r: string) => r === 'ruta-1-sur';
    expect(validateAction({ tipo: 'encolar', lote: 'SUR', ruta: 'ruta-1-sur', iniciar: true, comando: 'rm' }, lotes, exists, () => false)).toEqual({
      tipo: 'encolar',
      lote: 'SUR',
      ruta: 'ruta-1-sur',
      primero: false,
      iniciar: true,
    });
    expect(() => validateAction({ tipo: 'shell', cmd: 'ls' }, lotes, exists, () => false)).toThrow(/no permitida/);
    expect(() => validateAction({ tipo: 'encolar', lote: 'SUR', ruta: 'ruta-9-sur' }, lotes, exists, () => false)).toThrow(/no existe/);
    expect(() => validateAction({ tipo: 'cancelar', jobId: '; rm -rf' }, lotes, exists, () => true)).toThrow(/inválido/);
  });

  it('el resumen para Pi no lleva coordenadas', () => {
    const job = {
      id: 'jabc1234-abcdef',
      lote: 'SUR',
      unidad: { tipo: 'ruta', slug: 'ruta-2-sur', titulo: 'RUTA 2' },
      estado: 'COMPLETADO',
      etapa: 'reporte',
      parametros: { sinRed: false, refrescar: false, sinIa: false },
      creadoEn: '',
      encoladoEn: '',
      tiempos: { fuente: 1000 },
      intento: 1,
      archivosEntrada: [],
      archivosSalida: [],
      errores: [],
      advertencias: [],
      origen: 'chat',
      resultado: { mapas: 7, mapasConError: 0, trazos: 19, generados: 14, revision: 2, reporte: '' },
    } as Job;
    const p = piPrompt(job, {
      trazos: [
        { estado: 'GENERADO', nombreFinal: 'R2S-JOJU-TETEL', origen: 'JOJUTLA', destino: 'TETELPA', sentido: 'confirmado', inicio: { coord: [-99.17, 18.6] } },
      ],
      duplicados: [],
      ia: { intervenciones: [] },
    } as never);
    expect(p).toMatch(/14/);
    expect(p).toMatch(/R2S-JOJU-TETEL/);
    expect(p).not.toMatch(/-99\.17/);
  });
});

describe('Pi CLI como proceso hijo', () => {
  const setup = (script: string, timeoutMs = 5000) => {
    const dir = tmp('pi-');
    const launcher = join(dir, 'fake-pi.cjs');
    writeFileSync(launcher, script);
    const store = new CenterStore(join(dir, 'datos'), { ejecuciones: 10, logsPorEjecucion: 500, logsMemoria: 500, eventos: 100, chat: 10 });
    const logs = new LogService(store, null, 500);
    const pi = new PiService({ habilitado: true, node: process.execPath, launcher, timeoutMs }, 'qwen3.5:4b', logs, join(dir, 'cwd'));
    return { pi, logs };
  };

  it('captura los eventos JSONL reales y stderr (sanitizado), sin shell y con las opciones seguras', async () => {
    const { pi, logs } = setup(`
      const args = process.argv.slice(2);
      process.stderr.write('aviso: token=sk-abcdefghijklmnopqrstuvwx\\n');
      const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
      out({ type: 'session', id: 'x' });
      out({ type: 'agent_start' });
      out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'pensando' } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end', content: 'pensando' } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Se generaron ' } });
      out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '14 archivos. ARGS=' + args.filter(a => a.startsWith('--no-') || a === '--offline').join(',') } });
      out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Se generaron 14 archivos. ARGS=' + args.filter(a => a.startsWith('--no-') || a === '--offline').join(',') }], usage: { output: 12 }, stopReason: 'stop' } });
      out({ type: 'agent_end' });
    `);
    const partials: string[] = [];
    const r = await pi.run('jabc1234-abcdef', 'Explica', (t) => partials.push(t));
    expect(r.ok).toBe(true);
    expect(r.texto).toMatch(/^Se generaron 14 archivos/);
    for (const a of PI_SAFE_ARGS.filter((x) => x.startsWith('--no-') || x === '--offline')) expect(r.texto).toContain(a);
    const piLogs = logs.query({ componente: ['PI-CLI'], nivel: ['DEBUG', 'INFO', 'WARN', 'ERROR'] });
    expect(piLogs.some((l) => /Razonamiento terminado: 8 caracteres/.test(l.mensaje))).toBe(true);
    expect(piLogs.some((l) => /código 0/.test(l.mensaje))).toBe(true);
    const stderr = piLogs.find((l) => l.mensaje.startsWith('stderr:'))!;
    expect(stderr.mensaje).not.toMatch(/sk-abcdef/);
    expect(pi.status().ultima).toMatchObject({ ok: true, codigo: 0 });
  });

  it('un Pi que no termina se detiene al vencer el tiempo; no se lanzan dos a la vez', async () => {
    const { pi } = setup(`setInterval(() => {}, 1000);`, 300);
    const p = pi.run('jabc1234-abcdef', 'x', () => {});
    await expect(pi.run('jabc1234-abcdef', 'y', () => {})).rejects.toThrow(/ya está trabajando/);
    const r = await p;
    expect(r.ok).toBe(false);
  });

  it('sin Pi instalado se informa en lugar de fallar en silencio', async () => {
    const dir = tmp();
    const store = new CenterStore(join(dir, 'd'), { ejecuciones: 1, logsPorEjecucion: 1, logsMemoria: 1, eventos: 1, chat: 1 });
    const pi = new PiService(
      { habilitado: true, node: process.execPath, launcher: join(dir, 'no.js'), timeoutMs: 100 },
      'q',
      new LogService(store, null, 10),
      dir,
    );
    expect(pi.status().disponible).toBe(false);
    await expect(pi.run('j', 'x', () => {})).rejects.toThrow(/no está disponible/);
  });
});
