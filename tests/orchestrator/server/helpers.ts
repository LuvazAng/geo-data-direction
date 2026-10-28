import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Center } from '../../../src/orchestrator/server/center';
import type { CenterConfig } from '../../../src/orchestrator/server/config';
import type { LoteInfo } from '../../../src/orchestrator/config';
import { createCenterServer } from '../../../src/orchestrator/server/http';
import type { JobRunner } from '../../../src/orchestrator/server/jobs';
import type { Job } from '@protocol';
import { testConfig, tmp } from '../../helpers';

export const TOKEN = 'a'.repeat(64);

/** Lote de prueba con una fuente y un estado ya guardados (sin red). */
export function testLote(work: string, name = 'PRUEBA', rutas = ['ruta-1-sur', 'ruta-2-sur', 'ruta-3-sur']): LoteInfo {
  const config = testConfig(work, { lote: name });
  const root = resolve(work, name);
  mkdirSync(join(root, 'resultados'), { recursive: true });
  const maps = rutas.flatMap((slug, i) =>
    [1, 2].map((k) => ({
      id: `mapa${i}${k}xxxxxxxx`,
      kind: 'mymaps',
      title: `${k}. MAPA ${k}`,
      order: k,
      page: `https://sites.google.com/view/p/sur/${slug}`,
      pageSlug: slug,
      pageTitle: slug.toUpperCase(),
      downloadUrl: `https://www.google.com/maps/d/kml?mid=mapa${i}${k}`,
    })),
  );
  writeFileSync(
    join(root, 'fuente.json'),
    JSON.stringify({
      url: config.fuente.url,
      escaneadoEn: new Date().toISOString(),
      pages: rutas.map((slug) => ({ url: `https://sites.google.com/view/p/sur/${slug}`, slug, title: slug.toUpperCase(), status: 'ok', maps: 2 })),
      maps,
      diagnostics: [],
    }),
  );
  // la primera ruta ya procesada, la segunda con un error, la tercera sin procesar
  const mapas: Record<string, unknown> = {};
  maps
    .filter((m) => m.pageSlug === rutas[0])
    .forEach(
      (m) => (mapas[m.id] = { id: m.id, title: m.title, pageSlug: m.pageSlug, downloadUrl: m.downloadUrl, estado: 'GENERADO', intentos: 1, actualizadoEn: '' }),
    );
  maps
    .filter((m) => m.pageSlug === rutas[1])
    .forEach(
      (m, k) =>
        (mapas[m.id] = {
          id: m.id,
          title: m.title,
          pageSlug: m.pageSlug,
          downloadUrl: m.downloadUrl,
          estado: k ? 'ERROR' : 'GENERADO',
          error: k ? 'Error: HTTP 403' : undefined,
          intentos: 1,
          actualizadoEn: '',
        }),
    );
  writeFileSync(join(root, 'estado.json'), JSON.stringify({ version: 1, lote: name, fuente: '', creadoEn: '', actualizadoEn: '', mapas }));
  return { lote: name, zona: 'SUR', fuente: config.fuente.url, archivo: join(work, `${name}.json`), raiz: root, config };
}

export function centerConfig(datos: string, over: Partial<CenterConfig> = {}): CenterConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    lotes: [],
    datos,
    tokenArchivo: join(datos, 'token'),
    origenes: ['http://localhost:5199'],
    maxSimultaneas: 1,
    autoIniciar: true,
    retencion: { ejecuciones: 50, logsPorEjecucion: 200, logsMemoria: 500, eventos: 300, chat: 100 },
    pi: { habilitado: false, node: process.execPath, launcher: join(datos, 'no-existe.js'), timeoutMs: 5000 },
    ...over,
  };
}

/** Ejecutor simulado: cada ejecución espera a que la prueba la libere (o la cancele). */
export function controllableRunner() {
  const gates = new Map<string, { release: () => void; fail: (e: Error) => void }>();
  const started: string[] = [];
  const runner: JobRunner = (job, { signal, emit }) =>
    new Promise((resolveRun, reject) => {
      started.push(job.id);
      emit({ tipo: 'etapa', etapa: 'fuente' });
      emit({
        tipo: 'log',
        nivel: 'INFO',
        componente: 'ORCHESTRATOR',
        mensaje: `simulado ${job.id} token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl`,
      });
      emit({ tipo: 'etapa', etapa: 'descarga' });
      emit({ tipo: 'progreso', etapa: 'descarga', hechos: 1, total: 2 });
      emit({ tipo: 'archivo', estado: 'descargado', ruta: job.unidad.tipo === 'ruta' ? job.unidad.slug : '', mapa: 'm1', rel: 'originales/m1.kml' });
      const onAbort = () => {
        const e = new Error('abortado');
        e.name = 'AbortError';
        reject(e);
      };
      signal.addEventListener('abort', onAbort);
      gates.set(job.id, {
        release: () => {
          signal.removeEventListener('abort', onAbort);
          emit({ tipo: 'etapa', etapa: 'salida' });
          emit({ tipo: 'archivo', estado: 'generado', ruta: '', rel: 'resultados/SUR/X/1/A.kml' });
          resolveRun({
            rutas: [],
            mapas: 2,
            mapasConError: 0,
            trazos: 4,
            generados: 2,
            revision: 0,
            archivos: [{ rel: 'resultados/SUR/X/1/A.kml', tipo: 'resultado', estado: 'nuevo' }],
            obsoletos: [],
            conflictos: [],
            errores: [],
            advertencias: [],
            reporte: 'ejecuciones/x/reporte.md',
            tiempos: { fuente: 5, descarga: 10 },
          });
        },
        fail: (e) => reject(e),
      });
    });
  const waitStarted = async (n: number) => {
    for (let i = 0; i < 200 && started.length < n; i++) await new Promise((r) => setTimeout(r, 5));
  };
  const release = async (id: string) => {
    for (let i = 0; i < 200 && !gates.has(id); i++) await new Promise((r) => setTimeout(r, 5));
    gates.get(id)!.release();
  };
  return { runner, started, gates, waitStarted, release };
}

export const waitFor = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado esperando la condición');
    await new Promise((r) => setTimeout(r, 5));
  }
};

export function makeCenter(opts: { datos?: string; lotes?: LoteInfo[]; runner?: JobRunner; cfg?: Partial<CenterConfig> } = {}) {
  const work = tmp('centro-');
  const datos = opts.datos ?? join(work, '_centro');
  const lotes = opts.lotes ?? [testLote(work)];
  const ctl = controllableRunner();
  const center = new Center(centerConfig(datos, opts.cfg), lotes, { runner: opts.runner ?? ctl.runner, qwen: null, watch: false, heartbeatMs: 0 });
  return { center, ctl, datos, lotes, work };
}

export async function startServer(center: Center) {
  const server = createCenterServer(center, TOKEN);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(base + path, { ...init, headers: { 'x-centro-token': TOKEN, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  const json = async <T = unknown>(path: string, init?: Parameters<typeof req>[1]) => (await (await req(path, init)).json()) as T;
  const post = <T = unknown>(path: string, body: unknown) => json<T>(path, { method: 'POST', body: JSON.stringify(body) });
  return { server, base, port, req, json, post, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Lee eventos SSE de una respuesta hasta que `until` devuelva true (o se acabe el tiempo). */
export async function readEvents(res: Response, until: (evs: { id?: string; event: string; data: unknown }[]) => boolean, ms = 3000) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: { id?: string; event: string; data: unknown }[] = [];
  const t0 = Date.now();
  try {
    while (!until(events) && Date.now() - t0 < ms) {
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), ms)),
      ]);
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const e: { id?: string; event: string; data: unknown } = { event: 'message', data: null };
        for (const line of chunk.split('\n')) {
          if (line.startsWith('id: ')) e.id = line.slice(4);
          else if (line.startsWith('event: ')) e.event = line.slice(7);
          else if (line.startsWith('data: ')) e.data = JSON.parse(line.slice(6));
        }
        if (e.event !== 'message') events.push(e);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return events;
}

export type { Job };
