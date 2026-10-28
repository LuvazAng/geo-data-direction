// Descargas desde una fuente externa: sólo https, sólo hosts permitidos (también en cada
// redirección), con tiempo de espera, tamaño máximo, reintentos limitados y pausa entre
// peticiones. No se envían cookies ni credenciales.

export interface HttpPolicy {
  hosts: string[];
  timeoutMs: number;
  maxBytes: number;
  reintentos: number;
  pausaMs: number;
  userAgent: string;
}

export interface HttpResult {
  url: string;
  /** URL final tras las redirecciones. */
  finalUrl: string;
  status: number;
  contentType: string;
  /** Nombre sugerido por Content-Disposition, si viene. */
  fileName?: string;
  body: Uint8Array;
  intentos: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    /** true: vale la pena reintentar (red, tiempo, 429, 5xx, descarga incompleta). */
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

const MAX_REDIRECTS = 5;

/** Valida una URL contra la política: https, host en la lista, sin usuario/contraseña ni puerto raro. */
export function checkUrl(raw: string, hosts: string[], base?: string): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new HttpError(`URL inválida: ${raw}`, false);
  }
  if (url.protocol !== 'https:') throw new HttpError(`Sólo se permite https: ${url.href}`, false);
  if (url.username || url.password) throw new HttpError(`URL con credenciales: ${url.origin}`, false);
  if (url.port && url.port !== '443') throw new HttpError(`Puerto no permitido: ${url.host}`, false);
  if (!hosts.includes(url.hostname)) throw new HttpError(`Host no permitido: ${url.hostname}`, false);
  return url;
}

function fileNameOf(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* se usa el filename simple */
    }
  }
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1];
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class HttpClient {
  private last = 0;

  constructor(
    private readonly policy: HttpPolicy,
    private readonly fetchImpl: FetchLike = (i, o) => fetch(i, o),
    private readonly sleep: (ms: number) => Promise<void> = wait,
  ) {}

  /** GET con reintentos para errores transitorios. */
  async get(raw: string): Promise<HttpResult> {
    let lastError: HttpError | undefined;
    for (let attempt = 1; attempt <= this.policy.reintentos + 1; attempt++) {
      try {
        return { ...(await this.once(raw)), intentos: attempt };
      } catch (e) {
        lastError = e instanceof HttpError ? e : new HttpError(String((e as Error)?.message ?? e), true);
        if (!lastError.transient || attempt > this.policy.reintentos) break;
        await this.sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw lastError!;
  }

  private async throttle() {
    const delay = this.last + this.policy.pausaMs - Date.now();
    if (delay > 0) await this.sleep(delay);
    this.last = Date.now();
  }

  private async once(raw: string): Promise<Omit<HttpResult, 'intentos'>> {
    let url = checkUrl(raw, this.policy.hosts);
    for (let hop = 0; ; hop++) {
      await this.throttle();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.policy.timeoutMs);
      try {
        let res: Response;
        try {
          res = await this.fetchImpl(url.href, {
            redirect: 'manual',
            signal: ctrl.signal,
            credentials: 'omit',
            headers: { 'User-Agent': this.policy.userAgent, Accept: '*/*' },
          });
        } catch (e) {
          const aborted = (e as Error)?.name === 'AbortError';
          throw new HttpError(aborted ? `Tiempo de espera agotado (${this.policy.timeoutMs} ms)` : `Error de red: ${(e as Error)?.message}`, true);
        }

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) throw new HttpError(`Redirección ${res.status} sin destino`, false, res.status);
          if (hop >= MAX_REDIRECTS) throw new HttpError('Demasiadas redirecciones', false, res.status);
          url = checkUrl(location, this.policy.hosts, url.href);
          continue;
        }
        if (res.status === 429 || res.status >= 500) throw new HttpError(`HTTP ${res.status}`, true, res.status);
        if (res.status !== 200) throw new HttpError(`HTTP ${res.status}`, false, res.status);

        const declared = Number(res.headers.get('content-length') ?? NaN);
        if (declared > this.policy.maxBytes) throw new HttpError(`Respuesta demasiado grande (${declared} bytes)`, false);
        const body = await this.readLimited(res);
        if (Number.isFinite(declared) && body.length !== declared && !res.headers.get('content-encoding')) {
          throw new HttpError(`Descarga incompleta: ${body.length} de ${declared} bytes`, true);
        }
        return {
          url: raw,
          finalUrl: url.href,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          fileName: fileNameOf(res.headers.get('content-disposition')),
          body,
        };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async readLimited(res: Response): Promise<Uint8Array> {
    if (!res.body) return new Uint8Array(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.policy.maxBytes) {
          await reader.cancel();
          throw new HttpError(`Respuesta demasiado grande (> ${this.policy.maxBytes} bytes)`, false);
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(`Descarga interrumpida: ${(e as Error)?.message}`, true);
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
