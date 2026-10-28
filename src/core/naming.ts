import { normalize } from './analysis';

// Nombres de archivo de las rutas: RUTA-ORIGEN-DESTINO (R6O-12OCT-TLARG). Aquí está lo puro que comparten el editor y
// el orquestador: cómo se arman las siglas de un lugar, cómo se arma y se lee un nombre y cómo se evalúa qué tan cerca
// está de lo ideal. Qué siglas lleva cada lugar (catálogo, Qwen) lo decide el servidor; esto sólo las valida.

/** Máximo de caracteres de las siglas de un lugar. */
export const MAX_SIGLAS = 6;
/** Largo al que apuntan las siglas que se generan (12OCT, TLARG). */
export const SIGLAS_IDEAL = 5;

/** Palabras que no aportan a las siglas de un lugar. */
const STOP = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'E', 'EN', 'COL', 'COLONIA', 'FRACC', 'FRACCIONAMIENTO', 'U', 'H', 'UH', 'HAB', 'X', 'POR']);

const isNumber = (w: string) => /^\d+$/.test(w);
const significant = (text: string) =>
  normalize(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w));

/** Siglas válidas de un lugar: de 2 a 6 caracteres, mayúsculas y números. */
export const validSiglas = (siglas: string) => /^[A-Z0-9]{2,6}$/.test(siglas);

/**
 * Siglas de un lugar con una regla simple y repetible: las iniciales de las palabras que importan y, para completar, las
 * primeras letras de la última; los números se conservan enteros. «TIERRA LARGA» → TLARG, «12 DE OCTUBRE» → 12OCT,
 * «PABLO TORRES BURGOS» → PTBUR. Una sola palabra: sus primeras letras.
 */
export function abbreviatePlace(name: string, max = SIGLAS_IDEAL): string {
  const ws = significant(name);
  if (ws.length === 0) return '';
  if (ws.length === 1) return ws[0].slice(0, max);
  const head = ws
    .slice(0, -1)
    .map((w) => (isNumber(w) ? w : w[0]))
    .join('');
  const last = ws[ws.length - 1];
  const rest = isNumber(last) ? last : last.slice(0, Math.max(1, max - head.length));
  return (head + rest).slice(0, max);
}

export interface ParsedName {
  ruta: string;
  origen: string;
  destino: string;
  /** Número de un nombre repetido (-2, -3). */
  sufijo?: string;
}

const NAME_RE = /^([A-Z0-9_]+)-([A-Z0-9_]+)-([A-Z0-9_]+?)(?:-(\d+))?$/;

/** Lee un nombre RUTA-ORIGEN-DESTINO; si no tiene esa forma, null. */
export function parseName(name: string): ParsedName | null {
  const m = NAME_RE.exec(name.trim());
  return m ? { ruta: m[1], origen: m[2], destino: m[3], ...(m[4] ? { sufijo: m[4] } : {}) } : null;
}

export const buildName = (ruta: string, origen: string, destino: string) => `${ruta}-${origen}-${destino}`;

export type CriterionId = 'formato' | 'caracteres' | 'ruta' | 'siglas' | 'lugares' | 'unico';

export interface Criterion {
  id: CriterionId;
  ok: boolean;
  /** Lo que se pide. */
  titulo: string;
  /** Por qué cumple o no. */
  detalle: string;
}

export interface NameEvaluation {
  criterios: Criterion[];
  cumple: number;
  total: number;
  /** 0–100. */
  puntaje: number;
  /** Cumple todo. */
  ideal: boolean;
}

export interface PlaceSiglas {
  lugar: string;
  siglas: string;
}

export interface NameContext {
  /** Código de la ruta: R6O. */
  ruta: string;
  /** La colonia donde empieza el trazo (en el sentido en que va) y sus siglas. */
  inicio: PlaceSiglas;
  /** La colonia donde termina. */
  final: PlaceSiglas;
  /** Nombres que ya usan otros trazos. */
  ocupados?: ReadonlySet<string>;
}

/** Posición de un lugar dentro de un texto (sus palabras seguidas), o -1 si el texto no lo menciona. */
function mentionAt(textWords: string[], place: string): number {
  const pw = significant(place);
  if (pw.length === 0) return -1;
  for (let i = 0; i + pw.length <= textWords.length; i++) if (pw.every((w, k) => textWords[i + k] === w)) return i;
  return -1;
}

const CHAR_NAMES: Record<string, string> = { ' ': 'espacios', '.': 'puntos', ',': 'comas', '(': 'paréntesis', ')': 'paréntesis' };
/** Los caracteres no permitidos se nombran siempre en este orden; los demás van entre comillas al final. */
const CHAR_ORDER = ['espacios', 'puntos', 'comas', 'paréntesis', 'minúsculas'];
const charLabel = (c: string) => CHAR_NAMES[c] ?? (/[a-z]/.test(c) ? 'minúsculas' : `«${c}»`);
const rank = (label: string) => (CHAR_ORDER.includes(label) ? CHAR_ORDER.indexOf(label) : CHAR_ORDER.length);

/** Qué tan cerca está un nombre del ideal: seis criterios, cada uno con su motivo. */
export function evaluateName(name: string, ctx: NameContext): NameEvaluation {
  const parsed = parseName(name);
  const { inicio, final } = ctx;
  const criterios: Criterion[] = [];
  const add = (id: CriterionId, ok: boolean, titulo: string, detalle: string) => criterios.push({ id, ok, titulo, detalle });

  add(
    'formato',
    !!parsed,
    'Tiene la forma RUTA-ORIGEN-DESTINO',
    parsed ? 'Tiene sus tres partes separadas por guiones.' : 'No tiene tres partes separadas por guiones.',
  );

  const bad = [...new Set(name.replace(/[A-Z0-9_-]/g, '').split(''))];
  const badText = [...new Set(bad.map(charLabel))]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 5)
    .join(', ');
  add('caracteres', bad.length === 0, 'Sólo mayúsculas, números y guiones', bad.length === 0 ? 'No tiene espacios, acentos ni símbolos.' : `Tiene ${badText}.`);

  add(
    'ruta',
    parsed?.ruta === ctx.ruta,
    `Empieza con el código de la ruta (${ctx.ruta})`,
    parsed?.ruta === ctx.ruta ? `Empieza con ${ctx.ruta}.` : parsed ? `Empieza con ${parsed.ruta}; la ruta es ${ctx.ruta}.` : `Debe empezar con ${ctx.ruta}.`,
  );

  const shortOk = !!parsed && [parsed.origen, parsed.destino].every((s) => s.length >= 2 && s.length <= MAX_SIGLAS);
  add(
    'siglas',
    shortOk,
    `Siglas de 2 a ${MAX_SIGLAS} caracteres`,
    shortOk
      ? 'Origen y destino son cortos.'
      : parsed
        ? `${parsed.origen} y ${parsed.destino}: cada uno debe tener de 2 a ${MAX_SIGLAS} caracteres.`
        : 'No se pueden separar origen y destino.',
  );

  const expected = `${inicio.lugar} (${inicio.siglas}) a ${final.lugar} (${final.siglas})`;
  if (parsed) {
    const ok = parsed.origen === inicio.siglas && parsed.destino === final.siglas;
    add(
      'lugares',
      ok,
      'Origen y destino son las colonias de inicio y final',
      ok ? `Va de ${inicio.lugar} a ${final.lugar}.` : `Dice ${parsed.origen}-${parsed.destino}; el trazo va de ${expected}.`,
    );
  } else {
    // un nombre libre: se busca que mencione las dos colonias y en el orden en que el trazo las recorre
    const words = significant(name);
    const a = mentionAt(words, inicio.lugar);
    const b = mentionAt(words, final.lugar);
    const ok = a >= 0 && b >= 0 && a < b;
    const detalle = ok
      ? `Menciona ${inicio.lugar} y luego ${final.lugar}.`
      : a < 0 && b < 0
        ? `No menciona ${inicio.lugar} ni ${final.lugar}.`
        : a < 0
          ? `No menciona ${inicio.lugar}, donde empieza el trazo.`
          : b < 0
            ? `No menciona ${final.lugar}, donde termina el trazo.`
            : `Menciona los lugares al revés: el trazo va de ${expected}.`;
    add('lugares', ok, 'Origen y destino son las colonias de inicio y final', detalle);
  }

  const free = !ctx.ocupados?.has(name);
  add('unico', free, 'No lo usa otro trazo', free ? 'Ningún otro trazo lleva este nombre.' : 'Otro trazo ya usa este nombre.');

  const cumple = criterios.filter((c) => c.ok).length;
  return { criterios, cumple, total: criterios.length, puntaje: Math.round((cumple / criterios.length) * 100), ideal: cumple === criterios.length };
}

export interface NameComparison {
  mejor: 'propuesta' | 'otro' | 'igual';
  texto: string;
}

/** Cuál de dos nombres se acerca más al ideal (por criterios cumplidos). `otro` es el original o el actual. */
export function compareNames(otro: NameEvaluation, propuesta: NameEvaluation): NameComparison {
  const frase = `${propuesta.cumple} de ${propuesta.total} contra ${otro.cumple} de ${otro.total}`;
  if (propuesta.cumple > otro.cumple) return { mejor: 'propuesta', texto: `La propuesta se acerca más al nombre ideal (${frase}).` };
  if (propuesta.cumple < otro.cumple)
    return {
      mejor: 'otro',
      texto: `El nombre actual cumple más que la propuesta (${otro.cumple} de ${otro.total} contra ${propuesta.cumple}); revisa las siglas.`,
    };
  return { mejor: 'igual', texto: `Los dos cumplen lo mismo (${propuesta.cumple} de ${propuesta.total}).` };
}
