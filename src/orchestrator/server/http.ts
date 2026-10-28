import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { COMPONENTS, type Component, type Level, type Esfuerzo } from '@protocol';
import type { Center } from './center';
import { ActionError } from '../errors';
import { BadPath, fileContent, fileDetail, filesSnapshot, loteData } from './views';
import { decideMap, evaluateMap, resolveReview, resolveReviews, reviewSnapshot, undoMapReviews } from '../pipeline/reviews';
import { suggestSiglas } from './nombres';

// API del centro de control. Sólo escucha en 127.0.0.1 y cada petición debe:
//  - llegar con el token local (lo agrega el proxy de Vite; el navegador nunca lo ve),
//  - tener Host local (contra DNS rebinding) y, si trae Origin, que sea la app,
//  - en POST, ser JSON (un formulario de otro sitio no puede mandarlo sin CORS, que no se habilita).
// El navegador sólo puede pedir acciones de la lista permitida; no hay rutas ni comandos libres.

const MAX_BODY = 64 * 1024;
const MAX_REVIEW_BODY = 64 * 1024 * 1024;
/** Lugares que se pueden abreviar en una petición (un trazo y su pareja usan pocos). */
const MAX_LUGARES = 12;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(json);
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Se espera JSON (Content-Type: application/json)');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'Cuerpo demasiado grande');
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

const list = <T extends string>(v: string | null, allowed: readonly T[]) =>
  v ? v.split(',').filter((x): x is T => (allowed as readonly string[]).includes(x)) : undefined;

export function createCenterServer(center: Center, token: string): Server {
  const tokenBuf = Buffer.from(token);
  const port = center.cfg.port;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const authorize = (req: IncomingMessage, actualPort: number) => {
    const host = req.headers.host ?? '';
    if (!hosts.has(host) && host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) throw new HttpError(403, 'Host no permitido');
    const origin = req.headers.origin;
    if (origin && !center.cfg.origenes.includes(origin)) throw new HttpError(403, 'Origen no permitido');
    const given = Buffer.from(String(req.headers['x-centro-token'] ?? ''));
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf))
      throw new HttpError(401, 'Sin autorización (usa la app: el proxy de Vite agrega el token)');
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    const qs = url.searchParams;
    try {
      const addr = server.address();
      authorize(req, typeof addr === 'object' && addr ? addr.port : port);
      const m = req.method ?? 'GET';
      const seg = p.split('/').filter(Boolean); // api, ...
      if (seg[0] !== 'api') throw new HttpError(404, 'No encontrado');

      if (m === 'GET') {
        if (p === '/api/salud') return send(res, 200, { ok: true, bootId: center.hub.bootId, conectados: center.hub.connected });
        if (p === '/api/eventos') {
          const how = center.hub.attach(res, (req.headers['last-event-id'] as string | undefined) ?? qs.get('desde') ?? undefined);
          center.logs.add({
            nivel: 'DEBUG',
            componente: 'BACKEND',
            mensaje: `Navegador conectado (${how === 'reenvio' ? 'reconexión: se reenviaron los eventos perdidos' : 'estado completo'})`,
          });
          return;
        }
        if (p === '/api/estado') return send(res, 200, center.snapshot());
        if (p === '/api/rutas') return send(res, 200, center.routes(qs.get('lote') ?? undefined));
        if (p === '/api/modelos') return send(res, 200, await center.models());
        if (p === '/api/chat') {
          const conv = qs.get('conversacion');
          return send(res, 200, center.history(Math.min(500, Number(qs.get('limite') ?? 200)), conv ? center.conversation(conv).id : undefined));
        }
        if (p === '/api/conversaciones') return send(res, 200, center.conversationList());
        if (p === '/api/cola') return send(res, 200, center.jobs.queueState());
        if (p === '/api/jobs') {
          const estado = qs.get('estado')?.split(',');
          const lote = qs.get('lote');
          return send(
            res,
            200,
            center.jobs
              .list()
              .filter((j) => (!estado || estado.includes(j.estado)) && (!lote || j.lote === lote))
              .slice(0, Math.min(500, Number(qs.get('limite') ?? 200))),
          );
        }
        if (seg[1] === 'jobs' && seg[2] && !seg[3]) return send(res, 200, center.jobs.get(seg[2]));
        if (seg[1] === 'jobs' && seg[2] && seg[3] === 'reporte') return send(res, 200, center.jobReport(center.jobs.get(seg[2]).id));
        if (p === '/api/registros' || (seg[1] === 'jobs' && seg[3] === 'registros')) {
          const jobId = seg[1] === 'jobs' ? center.jobs.get(seg[2]).id : (qs.get('jobId') ?? undefined);
          if (jobId) center.jobs.get(jobId);
          return send(
            res,
            200,
            center.logs.query({
              jobId,
              componente: list<Component>(qs.get('componente'), COMPONENTS),
              nivel: list<Level>(qs.get('nivel'), ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const),
              ruta: qs.get('ruta') ?? undefined,
              lote: qs.get('lote') ?? undefined,
              q: qs.get('q')?.slice(0, 200) ?? undefined,
              antesDe: qs.get('antesDe') ? Number(qs.get('antesDe')) : undefined,
              limite: Math.min(5000, Number(qs.get('limite') ?? 500)),
            }),
          );
        }
        if (p === '/api/archivos') return send(res, 200, filesSnapshot(center.jobs.lote(String(qs.get('lote'))), qs.get('ruta') ?? undefined));
        if (p === '/api/revisiones') return send(res, 200, reviewSnapshot(center.jobs.lote(String(qs.get('lote')))));
        if (p === '/api/archivo') return send(res, 200, fileDetail(center.jobs.lote(String(qs.get('lote'))), String(qs.get('rel'))));
        if (p === '/api/archivo/contenido') {
          const f = fileContent(center.jobs.lote(String(qs.get('lote'))), String(qs.get('rel')));
          res.writeHead(200, {
            'Content-Type': f.nombre.toLowerCase().endsWith('.kmz') ? 'application/vnd.google-earth.kmz' : 'application/vnd.google-earth.kml+xml',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.nombre)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end(f.contenido);
        }
      }

      if (m === 'POST') {
        const body = await readJson(req, ['/api/revisiones', '/api/revisiones/lote', '/api/revisiones/mapa'].includes(p) ? MAX_REVIEW_BODY : MAX_BODY);
        if (p === '/api/chat') {
          // `pensar: false` (clientes anteriores) equivale a no razonar
          const esfuerzo = typeof body.esfuerzo === 'string' ? (body.esfuerzo as Esfuerzo) : body.pensar === false ? 'ninguno' : undefined;
          return send(
            res,
            200,
            await center.chat(String(body.texto ?? ''), {
              conversacion: body.conversacion as string | undefined,
              conversar: body.conversar !== false,
              esfuerzo,
            }),
          );
        }
        if (p === '/api/conversaciones') return send(res, 201, center.createConversation());
        if (p === '/api/chat/detener') {
          if (body.id !== undefined && (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id))) throw new HttpError(400, 'Id de mensaje inválido');
          return send(res, 200, { detenidas: center.stopQwen(body.id as string | undefined) });
        }
        if (p === '/api/acciones') return send(res, 200, await center.action(body.accion, body.conversacion));
        if (p === '/api/cola') {
          const lote = String(body.lote ?? '');
          const ruta = body.ruta === undefined ? undefined : String(body.ruta);
          if (ruta !== undefined && !center.routes(lote).some((u) => u.slug === ruta)) throw new HttpError(400, `La ruta ${ruta} no existe en ${lote}`);
          const par = (body.parametros ?? {}) as Record<string, unknown>;
          const clave = typeof body.clave === 'string' && /^[\w-]{8,80}$/.test(body.clave) ? body.clave : undefined;
          const titulo = ruta ? (center.routes(lote).find((u) => u.slug === ruta)?.titulo ?? ruta) : '';
          const r = center.jobs.enqueue(lote, ruta ? { tipo: 'ruta', slug: ruta, titulo } : { tipo: 'fuente' }, {
            parametros: { sinRed: par.sinRed === true, refrescar: par.refrescar === true, sinIa: par.sinIa === true },
            primero: body.primero === true,
            iniciar: body.iniciar === true,
            clave,
            origen: 'cola',
          });
          return send(res, r.creado ? 201 : 200, r);
        }
        if (p === '/api/revisiones') {
          const lote = center.jobs.lote(String(body.lote ?? ''));
          const accion = String(body.accion ?? '');
          if (!['generar', 'descartar', 'deshacer'].includes(accion)) throw new HttpError(400, 'Acción de revisión no válida');
          const tipo = body.tipo === undefined ? undefined : String(body.tipo);
          if (tipo !== undefined && !['propia', 'alternativa', 'ampliacion'].includes(tipo)) throw new HttpError(400, 'Tipo de revisión no válido');
          const sentido = body.sentido === undefined ? undefined : String(body.sentido);
          if (sentido !== undefined && !['directo', 'inverso', 'circuito'].includes(sentido)) throw new HttpError(400, 'Sentido de revisión no válido');
          const item = resolveReview(lote, {
            traza: String(body.traza ?? ''),
            accion: accion as 'generar' | 'descartar' | 'deshacer',
            tipo: tipo as 'propia' | 'alternativa' | 'ampliacion' | undefined,
            nombre: typeof body.nombre === 'string' ? body.nombre : undefined,
            nota: typeof body.nota === 'string' ? body.nota : undefined,
            origen: typeof body.origen === 'string' ? body.origen : undefined,
            destino: typeof body.destino === 'string' ? body.destino : undefined,
            sentido: sentido as 'directo' | 'inverso' | 'circuito' | undefined,
            relacionPrincipal: typeof body.relacionPrincipal === 'string' ? body.relacionPrincipal : undefined,
            contenidoKml: typeof body.contenidoKml === 'string' ? body.contenidoKml : undefined,
          });
          center.hub.publish({ type: 'folder.updated', data: { lote: lote.lote, rutas: [item.traza.ruta], motivo: 'resolución de revisión' } });
          center.refreshRoutes(lote.lote);
          return send(res, 200, item);
        }
        if (p === '/api/revisiones/lote') {
          const lote = center.jobs.lote(String(body.lote ?? ''));
          if (!Array.isArray(body.items)) throw new HttpError(400, 'Se requiere la lista de trazos a generar');
          const items = body.items.map((value) => {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'Trazo de revisión inválido');
            const item = value as Record<string, unknown>;
            // trazo eliminado en el editor: se descarta (se puede deshacer desde el centro)
            if (item.accion === 'descartar') {
              if (typeof item.traza !== 'string') throw new HttpError(400, 'Cada trazo requiere identificador');
              return {
                traza: item.traza,
                accion: 'descartar' as const,
                nota: typeof item.nota === 'string' ? item.nota : 'Eliminado en el editor al resolver el mapa',
              };
            }
            if (typeof item.traza !== 'string' || typeof item.nombre !== 'string' || typeof item.contenidoKml !== 'string') {
              throw new HttpError(400, 'Cada trazo requiere identificador, nombre y KML editado');
            }
            return {
              traza: item.traza,
              accion: 'generar' as const,
              tipo: 'propia' as const,
              nombre: item.nombre,
              nota: typeof item.nota === 'string' ? item.nota : 'Geometría editada en el mapa',
              contenidoKml: item.contenidoKml,
            };
          });
          const itemsResueltos = resolveReviews(lote, items);
          center.hub.publish({
            type: 'folder.updated',
            data: { lote: lote.lote, rutas: [...new Set(itemsResueltos.map((item) => item.traza.ruta))], motivo: 'resolución por lote del mapa' },
          });
          center.refreshRoutes(lote.lote);
          return send(res, 200, itemsResueltos);
        }
        if (p === '/api/revisiones/mapa') {
          // evaluación manual de un mapa sin itinerarios: lo que quedó en el editor, agrupado por dupla
          const lote = center.jobs.lote(String(body.lote ?? ''));
          if (typeof body.mapa !== 'string' || !body.mapa) throw new HttpError(400, 'Se requiere el mapa');
          if (!Array.isArray(body.generar) || !Array.isArray(body.descartar)) throw new HttpError(400, 'Se requieren los trazos a generar y a descartar');
          const record = (value: unknown) => {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'Trazo inválido');
            return value as Record<string, unknown>;
          };
          const generar = body.generar.map((value) => {
            const item = record(value);
            if (typeof item.traza !== 'string' || typeof item.nombre !== 'string' || typeof item.contenidoKml !== 'string' || typeof item.dupla !== 'number') {
              throw new HttpError(400, 'Cada trazo requiere identificador, nombre, KML editado y dupla');
            }
            return {
              traza: item.traza,
              nombre: item.nombre,
              contenidoKml: item.contenidoKml,
              dupla: item.dupla,
              nota: typeof item.nota === 'string' ? item.nota : undefined,
            };
          });
          const descartar = body.descartar.map((value) => {
            const item = record(value);
            if (typeof item.traza !== 'string') throw new HttpError(400, 'Cada trazo requiere identificador');
            return { traza: item.traza, nota: typeof item.nota === 'string' ? item.nota : undefined };
          });
          const items = evaluateMap(lote, { mapa: body.mapa, generar, descartar });
          center.hub.publish({
            type: 'folder.updated',
            data: { lote: lote.lote, rutas: [...new Set(items.map((item) => item.traza.ruta))], motivo: 'mapa evaluado a mano' },
          });
          center.refreshRoutes(lote.lote);
          return send(res, 200, items);
        }
        if (p === '/api/revisiones/decidir-mapa') {
          const lote = center.jobs.lote(String(body.lote ?? ''));
          if (typeof body.mapa !== 'string' || !body.mapa) throw new HttpError(400, 'Se requiere el mapa');
          if (body.accion !== 'descartar' && body.accion !== 'deshacer') throw new HttpError(400, 'Acción no válida');
          const decision = decideMap(lote, body.mapa, body.accion, typeof body.nota === 'string' ? body.nota : '');
          const ruta = loteData(lote).scan?.maps.find((m) => m.id === body.mapa)?.pageSlug;
          center.hub.publish({
            type: 'folder.updated',
            data: { lote: lote.lote, rutas: ruta ? [ruta] : [], motivo: body.accion === 'descartar' ? 'mapa descartado' : 'descarte del mapa deshecho' },
          });
          center.refreshRoutes(lote.lote);
          return send(res, 200, { decision });
        }
        if (p === '/api/revisiones/deshacer-mapa') {
          const lote = center.jobs.lote(String(body.lote ?? ''));
          if (typeof body.mapa !== 'string' || !body.mapa) throw new HttpError(400, 'Se requiere el mapa');
          const itemsDeshechos = undoMapReviews(lote, body.mapa);
          center.hub.publish({
            type: 'folder.updated',
            data: { lote: lote.lote, rutas: [...new Set(itemsDeshechos.map((item) => item.traza.ruta))], motivo: 'resolución del mapa deshecha' },
          });
          center.refreshRoutes(lote.lote);
          return send(res, 200, itemsDeshechos);
        }
        if (p === '/api/nombres/siglas') {
          const lote = center.jobs.lote(String(body.lote ?? ''));
          if (typeof body.traza !== 'string' || !body.traza) throw new HttpError(400, 'Falta el trazo');
          if (!Array.isArray(body.lugares) || body.lugares.length === 0 || body.lugares.length > MAX_LUGARES) {
            throw new HttpError(400, `Se requieren de 1 a ${MAX_LUGARES} lugares`);
          }
          const lugares = body.lugares.map((value) => {
            const item = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
            if (typeof item.nombre !== 'string' || !item.nombre.trim() || item.nombre.length > 120) {
              throw new HttpError(400, 'Cada lugar requiere un nombre de hasta 120 caracteres');
            }
            return {
              nombre: item.nombre.trim(),
              tipo: typeof item.tipo === 'string' ? item.tipo.slice(0, 60) : undefined,
              municipio: typeof item.municipio === 'string' ? item.municipio.slice(0, 60) : undefined,
            };
          });
          const r = await suggestSiglas(lote, center.qwen, { lote: lote.lote, traza: body.traza, lugares });
          const detalle = r.lugares.map((l) => `${l.nombre} → ${l.siglas} (${l.fuente})`).join('; ');
          center.logs.add({
            nivel: r.ia.error ? 'WARN' : 'INFO',
            componente: 'QWEN',
            lote: lote.lote,
            mensaje: `Siglas de ${r.ruta.codigo}: ${detalle}${r.ia.error ? ` · Qwen: ${r.ia.error}` : ''}`,
            duracionMs: r.ia.ms,
          });
          return send(res, 200, r);
        }
        if (p === '/api/cola/orden') {
          center.jobs.reorder(Array.isArray(body.ids) ? body.ids.map(String) : (null as never));
          return send(res, 200, center.jobs.queueState());
        }
        if (p === '/api/cola/pausar') return (center.jobs.pause(), send(res, 200, center.jobs.queueState()));
        if (p === '/api/cola/reanudar') return (center.jobs.resume(), send(res, 200, center.jobs.queueState()));
        if (p === '/api/cola/siguiente') return send(res, 200, { job: center.jobs.runNext() });
        if (seg[1] === 'jobs' && seg[2] && seg[3]) {
          const id = center.jobs.get(seg[2]).id;
          if (seg[3] === 'iniciar') return send(res, 200, { resultado: center.jobs.start(id), job: center.jobs.get(id) });
          if (seg[3] === 'primero') return (center.jobs.moveFirst(id), send(res, 200, center.jobs.queueState()));
          if (seg[3] === 'cancelar') return send(res, 200, { resultado: center.jobs.cancel(id), job: center.jobs.get(id) });
          if (seg[3] === 'reintentar') return send(res, 201, { job: center.jobs.retry(id) });
          if (seg[3] === 'explicar') return send(res, 200, await center.action({ tipo: 'explicar-con-pi', jobId: id }));
        }
      }
      throw new HttpError(404, 'No encontrado');
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof ActionError) return send(res, e.status, { error: e.message });
      if (e instanceof BadPath) return send(res, 400, { error: e.message });
      center.logs.add({ nivel: 'ERROR', componente: 'BACKEND', mensaje: `${req.method} ${p}: ${(e as Error)?.message ?? e}` });
      return send(res, 500, { error: 'Error interno (ver consola del centro)' });
    }
  });
  server.requestTimeout = 0; // el canal de eventos es de larga duración
  server.headersTimeout = 20_000;
  return server;
}
