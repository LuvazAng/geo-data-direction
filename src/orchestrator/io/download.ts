import { parseKmlAll, readKmlText } from '@core';
import { emitter, type Emit } from '@protocol';
import { HttpError, type HttpClient } from './http';
import type { MapRef } from './source';
import { setEstado, sha256, type BatchState, type MapState, type Workspace } from './store';

/** KMZ = ZIP. */
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

export class InvalidFileError extends Error {}

/**
 * Lee un KML/KMZ descargado y comprueba que sirva: XML bien formado y al menos un trazo.
 * El KMZ se abre en memoria (JSZip): nunca se extrae a disco, así que no hay rutas de
 * extracción que validar; sólo se lee el .kml principal.
 */
export async function kmlTextOf(body: Uint8Array, maxBytes: number): Promise<string> {
  let text: string;
  if (isZip(body)) {
    text = await readKmlText(new File([new Uint8Array(body)], 'map.kmz'));
  } else {
    text = new TextDecoder('utf-8').decode(body).replace(/^﻿/, '');
    if (!/<kml[\s>]/i.test(text.slice(0, 2000))) {
      const head = text.slice(0, 120).replace(/\s+/g, ' ');
      throw new InvalidFileError(`No es KML/KMZ (empieza con: ${head})`);
    }
  }
  if (text.length > maxBytes * 10) throw new InvalidFileError('KML descomprimido demasiado grande');
  try {
    parseKmlAll(text);
  } catch (e) {
    throw new InvalidFileError((e as Error).message);
  }
  return text;
}

export interface DownloadSummary {
  descargados: number;
  yaEstaban: number;
  errores: number;
  duplicados: { id: string; igualA: string }[];
}

/**
 * Descarga los mapas pendientes. Guarda el estado después de cada uno para poder reanudar; con
 * `signal` se puede cancelar entre un mapa y otro (nunca a mitad de escribir un original).
 */
export async function downloadMaps(
  maps: MapRef[],
  state: BatchState,
  ws: Workspace,
  http: HttpClient,
  maxBytes: number,
  opts: { refrescar?: boolean; log?: (s: string) => void; emit?: Emit; signal?: AbortSignal } = {},
): Promise<DownloadSummary> {
  const ev = emitter(opts.emit);
  const summary: DownloadSummary = { descargados: 0, yaEstaban: 0, errores: 0, duplicados: [] };
  const bySha = new Map<string, string>();
  for (const m of Object.values(state.mapas)) if (m.sha256) bySha.set(m.sha256, m.id);

  let done = 0;
  for (const ref of maps) {
    opts.signal?.throwIfAborted();
    ev.progress('descarga', done++, maps.length);
    const m: MapState = (state.mapas[ref.id] ??= {
      id: ref.id,
      title: ref.title,
      pageSlug: ref.pageSlug,
      downloadUrl: ref.downloadUrl,
      estado: 'PENDIENTE',
      intentos: 0,
      actualizadoEn: new Date().toISOString(),
    });
    Object.assign(m, { title: ref.title, pageSlug: ref.pageSlug, downloadUrl: ref.downloadUrl });

    const have = m.archivo && m.sha256 && ws.exists('originales', m.archivo) && sha256(ws.read('originales', m.archivo)) === m.sha256;
    if (have && !opts.refrescar && m.estado !== 'PENDIENTE' && m.estado !== 'ERROR') {
      summary.yaEstaban++;
      ev.file('ya-estaba', ref.pageSlug, { mapa: ref.id, rel: `originales/${m.archivo}`, detalle: ref.title });
      continue;
    }

    setEstado(m, 'DESCARGANDO');
    ws.saveState(state);
    ev.file('descargando', ref.pageSlug, { mapa: ref.id, detalle: ref.title });
    const t0 = Date.now();
    try {
      const res = await http.get(ref.downloadUrl);
      await kmlTextOf(res.body, maxBytes);
      const hash = sha256(res.body);
      const archivo = `${ref.id}.${isZip(res.body) ? 'kmz' : 'kml'}`;
      ws.write(['originales', archivo], res.body);
      const other = bySha.get(hash);
      if (other && other !== ref.id) summary.duplicados.push({ id: ref.id, igualA: other });
      bySha.set(hash, ref.id);
      setEstado(m, 'DESCARGADO', {
        sha256: hash,
        bytes: res.body.length,
        archivo,
        nombreServidor: res.fileName,
        descargadoEn: new Date().toISOString(),
        intentos: m.intentos + res.intentos,
      });
      summary.descargados++;
      opts.log?.(`  ✓ ${ref.pageSlug} · ${ref.title} (${res.body.length} bytes)`);
      ev.file('descargado', ref.pageSlug, { mapa: ref.id, rel: `originales/${archivo}`, detalle: ref.title });
      ev.info('DOWNLOAD', `${ref.title}: ${res.body.length} bytes${res.intentos > 1 ? ` (${res.intentos} intentos)` : ''}`, {
        ruta: ref.pageSlug,
        mapa: ref.id,
        duracionMs: Date.now() - t0,
        datos: { sha256: hash.slice(0, 12), archivo },
      });
    } catch (e) {
      const transient = e instanceof HttpError && e.transient;
      setEstado(m, 'ERROR', {
        error: `${e instanceof InvalidFileError ? 'Archivo inválido' : transient ? 'Error transitorio' : 'Error'}: ${(e as Error).message}`,
        intentos: m.intentos + 1,
      });
      summary.errores++;
      opts.log?.(`  ✗ ${ref.pageSlug} · ${ref.title}: ${m.error}`);
      ev.file('error', ref.pageSlug, { mapa: ref.id, detalle: m.error });
      ev.error('DOWNLOAD', `${ref.title}: ${m.error}`, { ruta: ref.pageSlug, mapa: ref.id, duracionMs: Date.now() - t0 });
    }
    ws.saveState(state);
  }
  ev.progress('descarga', done, maps.length);
  return summary;
}
