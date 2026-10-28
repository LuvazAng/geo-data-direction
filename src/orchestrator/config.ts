import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dataDirs, type DataDirs } from './paths';

// Configuración del orquestador: un JSON por lote (p. ej. config/lotes/sur.json) más variables
// de entorno para lo que cambia entre equipos (ver .env.example). Las carpetas de datos no van en el
// JSON: salen de GEODATA_DIR (paths.ts), aunque el JSON puede fijar alguna con una ruta relativa a él.

export interface OrqConfig {
  /** Nombre del lote: carpeta de trabajo, estado y reporte. */
  lote: string;
  /** Zona de las rutas (SUR, ORIENTE…): letra para números repetidos y carpeta de salida. */
  zona: string;
  fuente: {
    url: string;
    /** google-sites: página de zona → subpáginas → mapas de My Maps; enlaces-directos: <a href="*.kml|*.kmz">. */
    estrategia: 'google-sites' | 'enlaces-directos';
    /** Únicos hosts a los que se permite conectar (https). */
    hosts: string[];
    /** Filtro de subpáginas por slug (vacío = todas). */
    subpaginas: string[];
    /** Filtro de mapas por texto del título (vacío = todos). */
    mapas: string[];
    /** Otras páginas de zona: sus números de ruta deciden si hay que agregar la letra de zona. */
    zonasReferencia: string[];
    timeoutMs: number;
    maxBytes: number;
    reintentos: number;
    /** Pausa mínima entre peticiones al mismo sitio. */
    pausaMs: number;
    userAgent: string;
  };
  dirs: {
    /** Carpeta raíz de los lotes: <trabajo>/<lote>/… */
    trabajo: string;
    /** Rutas ya clasificadas a mano (<GEODATA_DIR>/RUTAS): se comparan y sirven de casos etiquetados. Opcional. */
    existentes: string;
    /** Marco Geoestadístico INEGI (17l, 17lpr, 17mun). */
    inegi: string;
    /** Colonias del INE (COLONIA y MUNICIPIO): si están, cada KML generado lleva las colonias por las que pasa. */
    colonias: string;
  };
  similitud: {
    /** Un punto "coincide" si queda a esta distancia o menos del otro trazo. */
    toleranciaM: number;
    /** Vértices a esta distancia o menos se consideran el mismo punto (trazos idénticos). */
    identicoM: number;
    /** Cobertura mínima en ambos sentidos para "casi idéntico". */
    casiIdentico: number;
    /** Razón mínima de longitudes (corta / larga) para "casi idéntico". */
    longitudCasiIdentica: number;
    /** Similitud mínima para "parcial". */
    parcial: number;
    /** Dos itinerarios forman dupla si coinciden al menos esto. */
    duplaMin: number;
    /** Tamaño de celda del índice espacial para elegir candidatos. */
    celdaM: number;
    /** % de celdas compartidas para comparar dos trazos a detalle. */
    candidatoMin: number;
  };
  extremos: {
    /** Distancia máxima de un extremo a la localidad candidata. */
    maxDistanciaM: number;
    /** Radio para agrupar extremos en una misma terminal. */
    terminalM: number;
  };
  nomenclatura: {
    /** Variables: {ruta} {origen} {destino} {via} */
    patron: string;
    patronCircuito: string;
    letraZona: Record<string, string>;
    /** Por slug de subpágina: código y carpeta de la ruta (tiene prioridad sobre la regla). */
    rutas: Record<string, { codigo?: string; carpeta?: string }>;
    /** Grupos sin número: nombre normalizado → código base (p. ej. INTERESCOLAR → INT_ESC). */
    rutasBase: Record<string, string>;
    /** Nombre normalizado de localidad / punto → código. */
    localidades: Record<string, string>;
    /** "Por dónde pasa" → código (LA GAS → GAS, LA FARMACIA → FARM). */
    vias: Record<string, string>;
    /** Agregar la vía al nombre siempre que el trazo la traiga, o sólo si hace falta para distinguir duplas. */
    incluirVia: 'siempre' | 'si-hay-varias';
    /** Variantes de escritura → nombre normalizado (TILZPOTLA → TILZAPOTLA). */
    alias: Record<string, string>;
    /** Localidad sin código: sugerir uno (marcado en el reporte) o mandar a revisión. */
    codigoNuevo: 'sugerir' | 'revision';
    /** Dos archivos con el mismo nombre: agregar sufijo -2, -3… o mandar a revisión. */
    colision: 'sufijo' | 'revision';
  };
  ia: {
    habilitada: boolean;
    url: string;
    modelo: string;
    timeoutMs: number;
    reintentos: number;
  };
  salida: {
    /** Sólo se generan archivos de los itinerarios (ida/regreso); ampliaciones y bases se reportan. */
    soloPrincipales: boolean;
    /** Copiar los casos en revisión a resultados/_REVISION para abrirlos en el editor. */
    copiarRevision: boolean;
  };
  /** Carpeta del archivo de configuración (para mensajes). */
  origen?: string;
}

const DEFAULTS: Omit<OrqConfig, 'lote' | 'zona' | 'fuente' | 'dirs'> & {
  fuente: Omit<OrqConfig['fuente'], 'url'>;
} = {
  fuente: {
    estrategia: 'google-sites',
    hosts: ['sites.google.com', 'www.google.com'],
    subpaginas: [],
    mapas: [],
    zonasReferencia: [],
    timeoutMs: 30_000,
    maxBytes: 20 * 1024 * 1024,
    reintentos: 2,
    pausaMs: 1000,
    userAgent: 'RutasMorelos-Orquestador/0.1 (uso interno; descarga de KML publicados)',
  },
  similitud: {
    toleranciaM: 25,
    identicoM: 1,
    casiIdentico: 0.95,
    longitudCasiIdentica: 0.9,
    parcial: 0.3,
    duplaMin: 0.4,
    celdaM: 150,
    candidatoMin: 0.2,
  },
  extremos: { maxDistanciaM: 2000, terminalM: 300 },
  nomenclatura: {
    patron: '{ruta}-{origen}-{destino}{via}',
    patronCircuito: '{ruta}-{origen}-{destino}{via}',
    letraZona: { SUR: 'S', ORIENTE: 'O' },
    rutas: {},
    rutasBase: {},
    localidades: {},
    vias: {},
    incluirVia: 'si-hay-varias',
    alias: {},
    codigoNuevo: 'sugerir',
    colision: 'sufijo',
  },
  ia: { habilitada: true, url: 'http://127.0.0.1:11434', modelo: 'qwen3.5:4b', timeoutMs: 180_000, reintentos: 1 },
  salida: { soloPrincipales: true, copiarRevision: true },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out && isObj(out[k]) && isObj(v) ? merge(out[k], v) : v;
  return out as T;
}

export class ConfigError extends Error {}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ConfigError(msg);
}

export function validateConfig(c: OrqConfig): OrqConfig {
  check(typeof c.lote === 'string' && /^[\w.-]{1,60}$/.test(c.lote), 'lote: sólo letras, números, punto, guion y guion bajo');
  check(typeof c.zona === 'string' && c.zona.trim(), 'zona es obligatoria');
  check(typeof c.fuente?.url === 'string' && c.fuente.url, 'fuente.url es obligatoria (o RUTAS_FUENTE_URL)');
  let url: URL;
  try {
    url = new URL(c.fuente.url);
  } catch {
    throw new ConfigError(`fuente.url no es una URL válida: ${c.fuente.url}`);
  }
  check(url.protocol === 'https:', 'fuente.url debe ser https');
  check(c.fuente.hosts.includes(url.hostname), `el host de fuente.url (${url.hostname}) no está en fuente.hosts`);
  check(['google-sites', 'enlaces-directos'].includes(c.fuente.estrategia), 'fuente.estrategia desconocida');
  for (const k of ['timeoutMs', 'maxBytes', 'pausaMs'] as const) check(c.fuente[k] > 0, `fuente.${k} debe ser > 0`);
  check(c.fuente.reintentos >= 0 && c.fuente.reintentos <= 5, 'fuente.reintentos entre 0 y 5');
  for (const k of ['trabajo', 'existentes', 'inegi', 'colonias'] as const) check(typeof c.dirs?.[k] === 'string' && c.dirs[k], `dirs.${k} es obligatorio`);
  const s = c.similitud;
  for (const k of ['casiIdentico', 'longitudCasiIdentica', 'parcial', 'duplaMin', 'candidatoMin'] as const)
    check(s[k] > 0 && s[k] <= 1, `similitud.${k} debe estar entre 0 y 1`);
  check(s.toleranciaM > 0 && s.identicoM >= 0 && s.celdaM > 0, 'similitud: distancias inválidas');
  const n = c.nomenclatura;
  check(n.patron.includes('{ruta}'), 'nomenclatura.patron debe incluir {ruta}');
  check(['sugerir', 'revision'].includes(n.codigoNuevo), 'nomenclatura.codigoNuevo: sugerir | revision');
  check(['sufijo', 'revision'].includes(n.colision), 'nomenclatura.colision: sufijo | revision');
  check(['siempre', 'si-hay-varias'].includes(n.incluirVia), 'nomenclatura.incluirVia: siempre | si-hay-varias');
  for (const [k, v] of [...Object.entries(n.localidades), ...Object.entries(n.vias)]) {
    check(/^[A-Z0-9_]{1,12}$/.test(v), `código inválido para «${k}»: ${v} (A-Z, 0-9, _; hasta 12)`);
  }
  const ia = new URL(c.ia.url);
  check(['127.0.0.1', 'localhost', '::1'].includes(ia.hostname), 'ia.url debe apuntar al runtime local');
  check(typeof c.ia.modelo === 'string' && c.ia.modelo, 'ia.modelo es obligatorio');
  return c;
}

export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): OrqConfig {
  const path = resolve(file);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Json;
  const c = merge(DEFAULTS as unknown as OrqConfig, raw);
  if (env.RUTAS_FUENTE_URL) c.fuente.url = env.RUTAS_FUENTE_URL;
  if (env.OLLAMA_URL) c.ia.url = env.OLLAMA_URL;
  c.dirs = dataDirs(env, isObj(raw.dirs) ? (raw.dirs as Partial<DataDirs>) : {}, dirname(path));
  c.origen = path;
  return validateConfig(c);
}

/** Un lote cargado: su configuración y de dónde se leyó. */
export interface LoteInfo {
  lote: string;
  zona: string;
  fuente: string;
  archivo: string;
  raiz: string;
  config: OrqConfig;
}
