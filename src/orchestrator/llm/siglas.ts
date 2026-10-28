import { MAX_SIGLAS, SIGLAS_IDEAL, normalize, validSiglas } from '@core';
import type { PlaceToAbbreviate } from '@protocol';
import type { QwenClient } from './llm';

/**
 * ¿Las siglas salen del nombre? Sus caracteres aparecen en orden dentro del nombre y empiezan como una de sus palabras.
 * Los números cuentan como cifras (12OCT sale de «12 de Octubre»); por eso no se usa `abbreviates` de los lugares, que
 * escribe los números con letra.
 */
export function derivesFrom(siglas: string, name: string): boolean {
  const words = normalize(name).split(' ').filter(Boolean);
  if (!words.some((w) => w[0] === siglas[0])) return false;
  let i = 0;
  for (const ch of words.join('')) if (ch === siglas[i]) i++;
  return i === siglas.length;
}

// Siglas de colonias para los nombres de archivo (R6O-12OCT-TLARG). Qwen sólo propone las siglas de lugares que el
// catálogo no conoce; aquí se validan una por una y las que no cumplen se descartan (el servidor usa entonces la regla
// de siglas). El nombre completo lo arma y lo evalúa el código, no el modelo.

export interface SiglasQuestion {
  lugares: PlaceToAbbreviate[];
  /** Siglas que ya usan las rutas clasificadas: el estilo que hay que imitar. */
  ejemplos: { lugar: string; siglas: string }[];
  /** Siglas que ya son de otro lugar. */
  ocupadas: string[];
}

export const SIGLAS_SCHEMA = {
  type: 'object',
  properties: {
    siglas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { lugar: { type: 'string' }, siglas: { type: 'string' } },
        required: ['lugar', 'siglas'],
      },
    },
  },
  required: ['siglas'],
} as const;

export const SIGLAS_SYSTEM = [
  'Abrevias nombres de colonias de Morelos, México, para los nombres de archivo de rutas de transporte público.',
  `Para cada lugar devuelve unas siglas de 3 a ${MAX_SIGLAS} caracteres (lo ideal es ${SIGLAS_IDEAL}): sólo letras mayúsculas A-Z y números 0-9, sin espacios, acentos ni símbolos.`,
  'Regla: toma la inicial de cada palabra importante y completa con las primeras letras de la última palabra; los números se conservan enteros',
  '(12 DE OCTUBRE → 12OCT, TIERRA LARGA → TLARG, PABLO TORRES BURGOS → PTBUR). Ignora DE, DEL, LA, LAS, EL, LOS, Y, COL, COLONIA.',
  'Las siglas deben salir del propio nombre: sus letras aparecen en el mismo orden dentro del nombre.',
  'Imita el estilo de los "ejemplos". No uses ninguna de las siglas "ocupadas" ni repitas siglas entre lugares.',
  'En "lugar" copia el nombre tal como viene. Responde sólo con el JSON pedido.',
].join(' ');

/** Valida la respuesta lugar por lugar: lo que no cumple se descarta (con su motivo) y ese lugar queda sin siglas. */
export function validateSiglas(raw: unknown, q: SiglasQuestion): { siglas: Map<string, string>; descartes: string[] } {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { siglas?: unknown }).siglas)) throw new Error('Respuesta sin "siglas"');
  const asked = new Map(q.lugares.map((l) => [normalize(l.nombre), l.nombre]));
  const ocupadas = new Set(q.ocupadas.map((c) => c.toUpperCase()));
  const siglas = new Map<string, string>();
  const used = new Set<string>();
  const descartes: string[] = [];
  for (const item of (raw as { siglas: Record<string, unknown>[] }).siglas) {
    const lugar = typeof item?.lugar === 'string' ? asked.get(normalize(item.lugar)) : undefined;
    if (!lugar) {
      descartes.push(`«${String(item?.lugar)}» no es uno de los lugares pedidos`);
      continue;
    }
    if (siglas.has(lugar)) continue;
    const code = typeof item.siglas === 'string' ? item.siglas.trim().toUpperCase() : '';
    if (!validSiglas(code)) descartes.push(`${lugar}: «${code}» no son de 2 a ${MAX_SIGLAS} mayúsculas o números`);
    else if (!derivesFrom(code, lugar)) descartes.push(`${lugar}: «${code}» no sale de su nombre`);
    else if (ocupadas.has(code) || used.has(code)) descartes.push(`${lugar}: «${code}» ya es de otro lugar`);
    else {
      siglas.set(lugar, code);
      used.add(code);
    }
  }
  return { siglas, descartes };
}

export interface SiglasAnswer {
  /** Siglas válidas por lugar (con el nombre tal como se pidió). */
  siglas: Map<string, string>;
  descartes: string[];
  error?: string;
  ms: number;
}

/** Pide a Qwen las siglas de los lugares. Si no responde o responde mal, `error` lo dice y no hay siglas. */
export async function askSiglas(client: QwenClient, q: SiglasQuestion): Promise<SiglasAnswer> {
  const payload = JSON.stringify({
    lugares: q.lugares.map((l) => ({ lugar: l.nombre, tipo: l.tipo ?? '', municipio: l.municipio ?? '' })),
    ejemplos: q.ejemplos,
    ocupadas: q.ocupadas,
  });
  let descartes: string[] = [];
  const r = await client.structured(
    SIGLAS_SYSTEM,
    payload,
    SIGLAS_SCHEMA,
    (raw) => {
      const v = validateSiglas(raw, q);
      descartes = v.descartes;
      return v.siglas;
    },
    { origen: 'editor', tarea: `siglas de ${q.lugares.length} colonia(s)` },
  );
  return { siglas: r.value ?? new Map(), descartes, error: r.error, ms: r.ms };
}
