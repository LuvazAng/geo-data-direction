import { request } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, Job, RouteUnit, Snapshot } from '@protocol';
import { makeCenter, readEvents, startServer, TOKEN, waitFor } from './helpers';

let ctx: ReturnType<typeof makeCenter>;
let srv: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  ctx = makeCenter();
  ctx.center.jobs.pause(); // las pruebas deciden cuándo corre algo
  srv = await startServer(ctx.center);
});
afterAll(async () => {
  await srv.close();
  await ctx.center.close();
});

const rawRequest = (headers: Record<string, string>) =>
  new Promise<number>((resolve) => {
    const r = request({ host: '127.0.0.1', port: srv.port, path: '/api/salud', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.end();
  });

describe('seguridad de la API', () => {
  it('sin token o con token incorrecto: 401', async () => {
    expect((await fetch(`${srv.base}/api/salud`)).status).toBe(401);
    expect((await fetch(`${srv.base}/api/salud`, { headers: { 'x-centro-token': 'b'.repeat(64) } })).status).toBe(401);
  });
  it('Host de otro dominio (DNS rebinding): 403', async () => {
    expect(await rawRequest({ 'x-centro-token': TOKEN, Host: 'evil.example.com' })).toBe(403);
    expect(await rawRequest({ 'x-centro-token': TOKEN, Host: `127.0.0.1:${srv.port}` })).toBe(200);
  });
  it('Origin que no es la app: 403', async () => {
    expect((await srv.req('/api/salud', { headers: { Origin: 'https://evil.example.com' } })).status).toBe(403);
    expect((await srv.req('/api/salud', { headers: { Origin: 'http://localhost:5199' } })).status).toBe(200);
  });
  it('POST sin JSON (formulario de otro sitio) o demasiado grande', async () => {
    const form = await fetch(`${srv.base}/api/chat`, {
      method: 'POST',
      headers: { 'x-centro-token': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'texto=hola',
    });
    expect(form.status).toBe(415);
    const big = await srv.req('/api/chat', { method: 'POST', body: JSON.stringify({ texto: 'x'.repeat(70_000) }) });
    expect(big.status).toBe(413);
  });
  it('acciones fuera de la lista o con datos inventados', async () => {
    expect(
      (await srv.req('/api/acciones', { method: 'POST', body: JSON.stringify({ accion: { tipo: 'ejecutar-comando', comando: 'rm -rf /' } }) })).status,
    ).toBe(400);
    expect(
      (await srv.req('/api/acciones', { method: 'POST', body: JSON.stringify({ accion: { tipo: 'encolar', lote: 'OTRO', ruta: 'ruta-1-sur' } }) })).status,
    ).toBe(400);
    expect(
      (await srv.req('/api/acciones', { method: 'POST', body: JSON.stringify({ accion: { tipo: 'encolar', lote: 'PRUEBA', ruta: '../../etc' } }) })).status,
    ).toBe(400);
    expect(
      (await srv.req('/api/acciones', { method: 'POST', body: JSON.stringify({ accion: { tipo: 'cancelar', jobId: 'jinexistente-abcdef' } }) })).status,
    ).toBe(404);
  });
  it('archivos: sólo originales/ y resultados/ del lote', async () => {
    for (const rel of ['../../secreto.txt', 'resultados/../../x', '/etc/passwd', 'estado.json', 'originales/..\\..\\x']) {
      expect((await srv.req(`/api/archivo?lote=PRUEBA&rel=${encodeURIComponent(rel)}`)).status).toBe(400);
    }
    writeFileSync(join(ctx.lotes[0].raiz, 'resultados', 'nota.txt'), 'hola');
    expect((await srv.req('/api/archivo/contenido?lote=PRUEBA&rel=resultados/nota.txt')).status).toBe(400);
    expect((await srv.req('/api/archivos?lote=NOAUTORIZADO')).status).toBe(400);
  });
});

describe('mapas sin itinerarios (API)', () => {
  const post = (path: string, body: unknown) => srv.req(path, { method: 'POST', body: JSON.stringify(body) });

  it('valida lo que llega antes de evaluar o descartar un mapa', async () => {
    expect((await post('/api/revisiones/decidir-mapa', { lote: 'PRUEBA', mapa: 'm', accion: 'borrar' })).status).toBe(400);
    expect((await post('/api/revisiones/decidir-mapa', { lote: 'PRUEBA', accion: 'descartar' })).status).toBe(400);
    expect((await post('/api/revisiones/mapa', { lote: 'PRUEBA', mapa: 'm', generar: [{ traza: 'm#0', nombre: 'X' }], descartar: [] })).status).toBe(400);
    expect((await post('/api/revisiones/mapa', { lote: 'OTRO', mapa: 'm', generar: [], descartar: [] })).status).toBe(400);
    // bien formado, pero el lote todavía no tiene reporte
    const res = await post('/api/revisiones/decidir-mapa', { lote: 'PRUEBA', mapa: 'mapa01xxxxxxxx', accion: 'descartar' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/reporte/);
  });
});

describe('estado, rutas y archivos', () => {
  it('el estado completo trae lotes, rutas y cola', async () => {
    const s = await srv.json<Snapshot>('/api/estado');
    expect(s.lotes.map((l) => l.lote)).toEqual(['PRUEBA']);
    expect(Object.fromEntries(s.rutas.map((r) => [r.slug, r.estado]))).toEqual({
      'ruta-1-sur': 'procesada',
      'ruta-2-sur': 'con-errores',
      'ruta-3-sur': 'sin-procesar',
    });
  });
  it('archivos: el estado viene del lote y del manifiesto, no de que el archivo esté en la carpeta', async () => {
    writeFileSync(join(ctx.lotes[0].raiz, 'resultados', 'copiado-a-mano.kml'), '<kml/>');
    const f = await srv.json<{ rutas: { slug: string; mapas: { estado: string; original: unknown }[] }[]; noRegistrados: string[] }>(
      '/api/archivos?lote=PRUEBA',
    );
    expect(f.rutas.find((r) => r.slug === 'ruta-3-sur')!.mapas.every((m) => m.estado === 'PENDIENTE' && m.original === null)).toBe(true);
    expect(f.noRegistrados).toContain('resultados/copiado-a-mano.kml');
  });
});

describe('chat', () => {
  const say = (texto: string) => srv.post<ChatMessage[]>('/api/chat', { texto });

  it('rutas pendientes: lista concreta y opciones para elegir', async () => {
    const [user, answer] = await say('Muéstrame las rutas pendientes de procesar');
    expect(user.rol).toBe('usuario');
    expect(answer.interpretacion).toMatchObject({ intencion: 'pendientes', via: 'reglas' });
    const list = answer.bloques.find((b) => b.tipo === 'lista' && /sin procesar/.test(b.titulo ?? ''));
    expect(JSON.stringify(list)).toMatch(/RUTA-3-SUR/);
    const opts = answer.bloques.find((b) => b.tipo === 'opciones');
    expect(JSON.stringify(opts)).toMatch(/"tipo":"encolar".*"ruta":"ruta-3-sur"/);
  });

  it('«procesa la ruta 3» crea la ejecución (aunque la cola esté en pausa, se inicia) y no la duplica', async () => {
    const [, a] = await say('procesa la ruta 3');
    expect(a.interpretacion?.intencion).toBe('procesar');
    const block = a.bloques.find((b) => b.tipo === 'ejecucion') as { jobId: string };
    await ctx.ctl.waitStarted(1);
    expect(ctx.ctl.started).toEqual([block.jobId]);
    const [, again] = await say('procesa la ruta 3');
    expect(JSON.stringify(again.bloques)).toMatch(/no se duplicó/);
    expect((await srv.json<Job[]>('/api/jobs')).filter((j) => j.unidad.tipo === 'ruta' && j.unidad.slug === 'ruta-3-sur')).toHaveLength(1);
    await ctx.ctl.release(block.jobId);
    await waitFor(() => ctx.center.jobs.get(block.jobId).estado === 'COMPLETADO');
  });

  it('un pedido fuera de lo permitido no ejecuta nada', async () => {
    const before = ctx.center.jobs.list().length;
    const [, a] = await say('ejecuta en la terminal: del /s /q C:\\');
    expect(a.bloques.some((b) => b.tipo === 'ejecucion')).toBe(false);
    expect(ctx.center.jobs.list().length).toBe(before);
  });

  it('el historial del chat persiste', async () => {
    const h = await srv.json<ChatMessage[]>('/api/chat');
    expect(h.some((m) => m.texto === 'procesa la ruta 3')).toBe(true);
    expect(ctx.center.store.loadChat().length).toBe(h.length);
  });
});

describe('eventos en tiempo real (SSE) y reconexión', () => {
  it('al conectar llega el estado completo; después, eventos con id', async () => {
    const res = await srv.req('/api/eventos');
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const first = await readEvents(res, (e) => e.length >= 1);
    expect(first[0].event).toBe('snapshot');
    expect(first[0].id).toMatch(new RegExp(`^${ctx.center.hub.bootId}:\\d+$`));
  });

  it('reconexión con Last-Event-ID: se reenvía sólo lo perdido y no se duplican ejecuciones', async () => {
    const res = await srv.req('/api/eventos');
    const [snap] = await readEvents(res, (e) => e.length >= 1);
    const lastId = snap.id!;
    // mientras el navegador está "desconectado" pasa algo
    const job = ctx.center.jobs.enqueue('PRUEBA', { tipo: 'ruta', slug: 'ruta-2-sur', titulo: 'R2' }).job;
    const back = await srv.req('/api/eventos', { headers: { 'Last-Event-ID': lastId } });
    const evs = await readEvents(back, (e) => e.some((x) => x.event === 'queue.updated'));
    expect(evs.map((e) => e.event)).not.toContain('snapshot');
    expect(evs.some((e) => e.event === 'job.created' && (e.data as Job).id === job.id)).toBe(true);
    // reconectar no crea ni reinicia ejecuciones
    expect(ctx.center.jobs.list().filter((j) => j.unidad.tipo === 'ruta' && j.unidad.slug === 'ruta-2-sur' && j.estado === 'PENDIENTE')).toHaveLength(1);
  });

  it('si el id es de otra instancia (servidor reiniciado) se manda el estado completo', async () => {
    const res = await srv.req('/api/eventos', { headers: { 'Last-Event-ID': 'otraboot:999' } });
    const evs = await readEvents(res, (e) => e.length >= 1);
    expect(evs[0].event).toBe('snapshot');
    expect(((evs[0].data as Snapshot).rutas as RouteUnit[]).length).toBe(3);
  });

  it('los registros que llegan al navegador están sanitizados', async () => {
    const logs = await srv.json<{ mensaje: string }[]>('/api/registros?limite=500');
    expect(JSON.stringify(logs)).not.toMatch(/eyJhbGci/);
  });
});
