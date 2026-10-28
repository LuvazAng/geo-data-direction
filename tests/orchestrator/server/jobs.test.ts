import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Center } from '../../../src/orchestrator/server/center';
import type { JobRunner } from '../../../src/orchestrator/server/jobs';
import { tmp } from '../../helpers';
import { centerConfig, controllableRunner, makeCenter, testLote, waitFor } from './helpers';

const unit = (slug: string) => ({ tipo: 'ruta' as const, slug, titulo: slug });
const opened: Center[] = [];
const track = (c: Center) => (opened.push(c), c);
afterEach(async () => {
  for (const c of opened.splice(0)) await c.close();
});

describe('cola y ejecuciones', () => {
  it('toma la siguiente automáticamente y un lote corre de una en una', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    const a = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    const b = center.jobs.enqueue('PRUEBA', unit('ruta-2-sur')).job;
    await ctl.waitStarted(1);
    expect(center.jobs.get(a.id).estado).toBe('EN_DESCARGA');
    expect(center.jobs.get(b.id).estado).toBe('PENDIENTE');
    await ctl.release(a.id);
    await waitFor(() => center.jobs.get(b.id).estado === 'EN_DESCARGA');
    expect(center.jobs.get(a.id)).toMatchObject({ estado: 'COMPLETADO', resultado: { generados: 2 } });
    expect(center.jobs.get(a.id).archivosEntrada).toEqual(['originales/m1.kml']);
    await ctl.release(b.id);
  });

  it('no duplica: misma ruta pendiente o en curso, o misma clave de idempotencia', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    const first = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur'), { clave: 'clave-abcdefgh' });
    const again = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur'));
    const sameKey = center.jobs.enqueue('PRUEBA', unit('ruta-2-sur'), { clave: 'clave-abcdefgh' });
    expect(first.creado).toBe(true);
    expect(again).toMatchObject({ creado: false, job: { id: first.job.id } });
    expect(sameKey).toMatchObject({ creado: false, job: { id: first.job.id } });
    expect(center.jobs.list()).toHaveLength(1);
    await ctl.release(first.job.id);
  });

  it('con la cola en pausa no toma nada solo, pero «procesar la siguiente» sí corre una', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    center.jobs.pause();
    const a = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    const b = center.jobs.enqueue('PRUEBA', unit('ruta-2-sur')).job;
    await new Promise((r) => setTimeout(r, 30));
    expect(ctl.started).toEqual([]);
    expect(center.jobs.runNext()?.id).toBe(a.id);
    await ctl.release(a.id);
    await waitFor(() => center.jobs.get(a.id).estado === 'COMPLETADO');
    await new Promise((r) => setTimeout(r, 30));
    expect(center.jobs.get(b.id).estado).toBe('PENDIENTE'); // sigue en pausa
  });

  it('reordenar, pasar al frente e iniciar una en particular', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    center.jobs.pause();
    const [a, b, c] = ['ruta-1-sur', 'ruta-2-sur', 'ruta-3-sur'].map((s) => center.jobs.enqueue('PRUEBA', unit(s)).job);
    expect(() => center.jobs.reorder([a.id, b.id])).toThrow(/exactamente/);
    center.jobs.reorder([c.id, a.id, b.id]);
    expect(center.jobs.queueState().orden).toEqual([c.id, a.id, b.id]);
    center.jobs.moveFirst(b.id);
    expect(center.jobs.queueState().orden[0]).toBe(b.id);
    expect(center.jobs.start(a.id)).toBe('iniciada');
    // ya hay una corriendo en el lote: la que se pide iniciar queda al frente
    expect(center.jobs.start(c.id)).toBe('al-frente');
    expect(center.jobs.queueState().orden[0]).toBe(c.id);
    // reordenar no reinicia la que está corriendo
    center.jobs.reorder([...center.jobs.queueState().orden].reverse());
    expect(center.jobs.get(a.id).estado).toBe('EN_DESCARGA');
    expect(ctl.started).toEqual([a.id]);
    await ctl.release(a.id);
  });

  it('cancelar: pendiente inmediato, en curso en el siguiente punto seguro, nunca escribiendo resultados', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    const a = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    const b = center.jobs.enqueue('PRUEBA', unit('ruta-2-sur')).job;
    expect(center.jobs.cancel(b.id)).toBe('cancelada');
    expect(center.jobs.get(b.id).estado).toBe('CANCELADO');
    await ctl.waitStarted(1);
    expect(center.jobs.cancel(a.id)).toBe('solicitada');
    await waitFor(() => center.jobs.get(a.id).estado === 'CANCELADO');
    expect(() => center.jobs.cancel(a.id)).toThrow(/ya terminó/);
    // en la etapa de salida no se acepta
    const c = center.jobs.enqueue('PRUEBA', unit('ruta-3-sur')).job;
    await ctl.waitStarted(2);
    center.jobs.get(c.id).etapa = 'salida';
    expect(() => center.jobs.cancel(c.id)).toThrow(/no es seguro/);
    await ctl.release(c.id);
  });

  it('falla, se reintenta como ejecución nueva al frente; un completado sin errores no se reintenta', async () => {
    const { center, ctl } = makeCenter();
    track(center);
    const a = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    await ctl.waitStarted(1);
    ctl.gates.get(a.id)!.fail(new Error('Ollama no disponible'));
    await waitFor(() => center.jobs.get(a.id).estado === 'FALLIDO');
    expect(center.jobs.get(a.id).errores).toContain('Ollama no disponible');
    const r = center.jobs.retry(a.id);
    expect(r).toMatchObject({ intento: 2, reintentoDe: a.id });
    await ctl.waitStarted(2);
    await ctl.release(r.id);
    await waitFor(() => center.jobs.get(r.id).estado === 'COMPLETADO');
    expect(() => center.jobs.retry(r.id)).toThrow(/sin errores/);
  });

  it('límite de simultáneas entre lotes distintos', async () => {
    const work = tmp('centro-');
    const lotes = [testLote(work, 'A'), testLote(work, 'B')];
    const one = controllableRunner();
    const c1 = track(new Center(centerConfig(join(work, 'c1')), lotes, { runner: one.runner, qwen: null, watch: false, heartbeatMs: 0 }));
    c1.jobs.enqueue('A', unit('ruta-1-sur'));
    c1.jobs.enqueue('B', unit('ruta-1-sur'));
    await one.waitStarted(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(one.started).toHaveLength(1);
    await c1.close();
    opened.pop();

    const two = controllableRunner();
    const c2 = track(
      new Center(centerConfig(join(work, 'c2'), { maxSimultaneas: 2 }), lotes, { runner: two.runner, qwen: null, watch: false, heartbeatMs: 0 }),
    );
    const x = c2.jobs.enqueue('A', unit('ruta-2-sur')).job;
    const y = c2.jobs.enqueue('B', unit('ruta-2-sur')).job;
    await two.waitStarted(2);
    expect(two.started.sort()).toEqual([x.id, y.id].sort());
    await two.release(x.id);
    await two.release(y.id);
  });

  it('tras reiniciar el servidor: historial y cola se conservan; lo que corría queda INTERRUMPIDO (no se reanuda solo)', async () => {
    const work = tmp('centro-');
    const lotes = [testLote(work)];
    const datos = join(work, '_centro');
    const ctl = controllableRunner();
    const c1 = new Center(centerConfig(datos), lotes, { runner: ctl.runner, qwen: null, watch: false, heartbeatMs: 0 });
    const running = c1.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    const pending = c1.jobs.enqueue('PRUEBA', unit('ruta-2-sur')).job;
    await ctl.waitStarted(1);
    c1.jobs.pause();
    c1.jobs.flush();
    // "apagón": no se llama a close(); se abre otra instancia sobre los mismos datos
    const ctl2 = controllableRunner();
    const c2 = track(new Center(centerConfig(datos), lotes, { runner: ctl2.runner, qwen: null, watch: false, heartbeatMs: 0 }));
    expect(c2.jobs.get(running.id).estado).toBe('INTERRUMPIDO');
    expect(c2.jobs.get(running.id).errores.join()).toMatch(/No se reanuda sola/);
    expect(c2.jobs.get(pending.id).estado).toBe('PENDIENTE');
    expect(c2.jobs.queueState()).toMatchObject({ orden: [pending.id], pausada: true });
    expect(c2.logs.query({ jobId: running.id }).some((l) => /Interrumpida por un reinicio/.test(l.mensaje))).toBe(true);
    // el reintento existe y es una ejecución nueva
    expect(c2.jobs.retry(running.id).reintentoDe).toBe(running.id);
    await ctl.release(running.id).catch(() => {});
    await c1.close().catch(() => {});
  });

  it('los registros se guardan sanitizados y con su componente', async () => {
    const { center, ctl, datos } = makeCenter();
    track(center);
    const a = center.jobs.enqueue('PRUEBA', unit('ruta-1-sur')).job;
    await ctl.release(a.id);
    await waitFor(() => center.jobs.get(a.id).estado === 'COMPLETADO');
    const disk = readFileSync(join(datos, 'registros', `${a.id}.jsonl`), 'utf8');
    expect(disk).not.toMatch(/eyJhbGci/);
    expect(disk).toMatch(/\[oculto\]/);
    const comps = new Set(center.logs.query({ jobId: a.id }).map((l) => l.componente));
    expect([...comps].sort()).toEqual(['BACKEND', 'ORCHESTRATOR']);
  });

  it('retención: se conservan sólo las últimas ejecuciones terminadas', async () => {
    const runner: JobRunner = async () => ({
      rutas: [],
      mapas: 0,
      mapasConError: 0,
      trazos: 0,
      generados: 0,
      revision: 0,
      archivos: [],
      obsoletos: [],
      conflictos: [],
      errores: [],
      advertencias: [],
      reporte: '',
      tiempos: {},
    });
    const { center } = makeCenter({ runner, cfg: { retencion: { ejecuciones: 2, logsPorEjecucion: 50, logsMemoria: 100, eventos: 100, chat: 10 } } });
    track(center);
    for (const s of ['ruta-1-sur', 'ruta-2-sur', 'ruta-3-sur', 'ruta-1-sur']) {
      const j = center.jobs.enqueue('PRUEBA', unit(s)).job;
      await waitFor(() => center.jobs.get(j.id).estado === 'COMPLETADO');
      await new Promise((r) => setTimeout(r, 5));
    }
    center.jobs.flush();
    expect(center.jobs.list()).toHaveLength(2);
  });
});
