import { homedir } from 'node:os';

// Todo lo que entra a la consola pasa por aquí: los registros los ven en el navegador y se
// guardan en disco, así que no deben llevar credenciales, tokens ni datos del equipo.

const REDACTED = '[oculto]';
const MAX_MESSAGE = 4000;
const MAX_DATA = 20_000;

const SENSITIVE_KEY = /(pass(word)?|contrase(n|ñ)a|secret|token|api[-_]?key|apikey|authorization|auth|cookie|credential|private[-_]?key|bearer|jwt|session)/i;

const PATTERNS: [RegExp, string][] = [
  // JWT (tres partes base64url, la primera empieza con eyJ)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // encabezados de autorización
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // claves con prefijos conocidos
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // clave=valor / "clave": "valor" con nombres sensibles
  [
    /((?:pass(?:word)?|contrase(?:n|ñ)a|secret|token|api[-_]?key|apikey|authorization|cookie|credential|jwt)\w*)(\s*[=:]\s*)("?)[^\s"&,;]{3,}\3/gi,
    `$1$2$3${REDACTED}$3`,
  ],
  // credenciales en URLs (https://usuario:clave@host)
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // parámetros sensibles en query strings
  [/([?&](?:key|token|access_token|api_key|apikey|auth|sig|signature)=)[^&\s]+/gi, `$1${REDACTED}`],
];

let home = '';
try {
  home = homedir();
} catch {
  home = '';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const homeRe = home ? new RegExp(escapeRe(home).replace(/\\\\/g, '[\\\\/]'), 'gi') : null;
const homeRePosix = home ? new RegExp(escapeRe(home.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`)), 'gi') : null;

export function sanitizeText(input: unknown, max = MAX_MESSAGE): string {
  let s = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  if (homeRe) s = s.replace(homeRe, '~');
  if (homeRePosix) s = s.replace(homeRePosix, '~');
  // caracteres de control (excepto salto de línea y tabulador)
  // eslint-disable-next-line no-control-regex -- es justo lo que se quiere quitar
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} caracteres más)` : s;
}

/** Copia sanitizada de datos estructurados: oculta claves sensibles y acorta textos largos. */
export function sanitizeData<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeText(value, 1000) as T;
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[…]' as T;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeData(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : sanitizeData(v, depth + 1);
  }
  const json = JSON.stringify(out);
  return (json.length > MAX_DATA ? { recortado: true, vista: json.slice(0, MAX_DATA) } : out) as T;
}

/** Variables de entorno que se pasan a un proceso hijo: sólo las necesarias, nunca secretos. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allow = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'LC_ALL',
    'TZ',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of allow) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}
