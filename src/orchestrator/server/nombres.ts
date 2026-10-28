import { MAX_SIGLAS, abbreviatePlace, normalize, validSiglas } from '@core';
import type { CodeSource, PlaceToAbbreviate, SiglasRequest, SiglasResponse, SiglasResult, SiglasSource } from '@protocol';
import type { LoteInfo } from '../config';
import { placeKey } from '../domain/labeled';
import { sameKey } from '../domain/places';
import { ActionError } from '../errors';
import type { QwenClient } from '../llm/llm';
import { askSiglas } from '../llm/siglas';
import { load } from '../pipeline/reviews/store';
import type { Report } from '../pipeline/report';
import type { Workspace } from '../io/store';

// Siglas de los lugares para el nombre de un trazo que se resuelve a mano: primero el catálogo del lote (el mismo lugar
// lleva siempre las mismas siglas), después Qwen para lo que falta y, si no responde o responde mal, la regla de siglas.

interface Known {
  nombre: string;
  key: string;
  siglas: string;
  fuente: CodeSource;
}

/** Siglas que ya existen en el lote: configuración > aprendidas de las rutas clasificadas > sugeridas en el reporte. */
function knownCodes(lote: LoteInfo, ws: Workspace, report: Report): Known[] {
  const alias = lote.config.nomenclatura.alias;
  const out: Known[] = [];
  const add = (nombre: string, siglas: string, fuente: CodeSource) => {
    const key = placeKey(nombre, alias);
    if (key && siglas) out.push({ nombre, key, siglas: siglas.toUpperCase(), fuente });
  };
  for (const [nombre, siglas] of Object.entries(lote.config.nomenclatura.localidades)) add(nombre, siglas, 'config');
  const learned = ws.readJson<{ localidades?: { codigos?: Record<string, string> } } | null>(['catalogo-aprendido.json'], null);
  for (const [nombre, siglas] of Object.entries(learned?.localidades?.codigos ?? {})) add(nombre, siglas, 'aprendido');
  for (const s of report.codigos.sugeridos) add(s.nombre, s.codigo, 'sugerido');
  return out;
}

/** Unas siglas que nadie usa: la regla de siglas y, si chocan, una cifra al final. */
function freeSiglas(name: string, taken: ReadonlySet<string>): string {
  const base = abbreviatePlace(name) || normalize(name).replace(/ /g, '').slice(0, 5);
  const candidates = [base, abbreviatePlace(name, MAX_SIGLAS), ...Array.from({ length: 8 }, (_, i) => `${base.slice(0, MAX_SIGLAS - 1)}${i + 2}`)];
  return candidates.find((c) => validSiglas(c) && !taken.has(c)) ?? base;
}

const ruleNote = (qwen: QwenClient | null, error?: string) =>
  !qwen
    ? 'La IA está desactivada: se usó la regla de siglas.'
    : error
      ? `Qwen no respondió (${error}): se usó la regla de siglas.`
      : 'Qwen no dio siglas válidas: se usó la regla de siglas.';

/**
 * Siglas para los lugares de un trazo y el código de su ruta. Siempre responde algo útil: si Qwen no está, no contesta o
 * se equivoca, el lugar lleva las siglas de la regla y la respuesta lo dice.
 */
export async function suggestSiglas(lote: LoteInfo, qwen: QwenClient | null, req: SiglasRequest): Promise<SiglasResponse> {
  const { ws, report } = load(lote);
  if (!report) throw new ActionError('Este lote todavía no tiene reporte: procesa al menos una ruta antes de nombrar a mano.', 409);
  const trace = report.trazos.find((t) => t.id === req.traza);
  if (!trace) throw new ActionError('Ese trazo no está en el reporte del lote.', 404);
  const route = report.codigos.rutas.find((r) => r.slug === trace.ruta) ?? report.paginas.find((p) => p.slug === trace.ruta)?.codigoRuta;
  if (!route) throw new ActionError(`No se encontró el código de la ruta ${trace.ruta}.`, 404);

  const alias = lote.config.nomenclatura.alias;
  const known = knownCodes(lote, ws, report);
  const taken = new Set(known.map((k) => k.siglas));
  const results = new Map<string, SiglasResult>();
  const pending: PlaceToAbbreviate[] = [];
  for (const place of req.lugares) {
    if (results.has(place.nombre) || pending.some((p) => p.nombre === place.nombre)) continue;
    const key = placeKey(place.nombre, alias);
    const hit = known.find((k) => k.key === key) ?? known.find((k) => sameKey(k.key, key));
    if (hit) results.set(place.nombre, { nombre: place.nombre, siglas: hit.siglas, fuente: hit.fuente });
    else pending.push(place);
  }

  const ia: SiglasResponse['ia'] = { habilitada: !!qwen, usada: false, modelo: qwen?.modelo, descartes: [] };
  let proposed = new Map<string, string>();
  if (pending.length && qwen) {
    const examples = known.slice(0, 20).map((k) => ({ lugar: k.nombre, siglas: k.siglas }));
    const answer = await askSiglas(qwen, { lugares: pending, ejemplos: examples, ocupadas: [...taken] });
    proposed = answer.siglas;
    Object.assign(ia, { usada: !answer.error, ms: answer.ms, error: answer.error, descartes: answer.descartes });
  }
  for (const place of pending) {
    const fromModel = proposed.get(place.nombre);
    // las siglas de Qwen se vuelven a comprobar contra lo asignado hasta ahora en esta misma petición
    const usable = fromModel && !taken.has(fromModel) ? fromModel : undefined;
    const siglas = usable ?? freeSiglas(place.nombre, taken);
    const fuente: SiglasSource = usable ? 'qwen' : 'regla';
    taken.add(siglas);
    results.set(place.nombre, { nombre: place.nombre, siglas, fuente, ...(usable ? {} : { nota: ruleNote(qwen, ia.error) }) });
  }

  return {
    ruta: { codigo: route.codigo, fuente: route.origen },
    lugares: req.lugares.map((l) => results.get(l.nombre)!).filter((r, i, all) => all.indexOf(r) === i),
    ia,
  };
}
