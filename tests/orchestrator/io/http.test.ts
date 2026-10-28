import { describe, expect, it } from 'vitest';
import { checkUrl, HttpClient, HttpError, type HttpPolicy } from '../../../src/orchestrator/io/http';
import { fakeFetch } from '../../helpers';

const policy: HttpPolicy = { hosts: ['sites.google.com', 'www.google.com'], timeoutMs: 2000, maxBytes: 1000, reintentos: 2, pausaMs: 0, userAgent: 'prueba' };
const URL1 = 'https://www.google.com/maps/d/kml?mid=abcdefghijk&forcekml=1';
const noSleep = async () => {};

describe('seguridad de la URL de la fuente', () => {
  it.each([
    ['http://sites.google.com/view/x', /https/],
    ['https://evil.example.com/a.kml', /Host no permitido/],
    ['https://127.0.0.1/a.kml', /Host no permitido/],
    ['https://localhost/a.kml', /Host no permitido/],
    ['https://user:pass@sites.google.com/x', /credenciales/],
    ['https://sites.google.com:8443/x', /Puerto/],
    ['file:///etc/passwd', /https/],
  ])('rechaza %s', (url, msg) => {
    expect(() => checkUrl(url, policy.hosts)).toThrow(msg);
  });

  it('una redirección hacia un host no permitido se rechaza', async () => {
    const { impl } = fakeFetch({ [URL1]: { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } });
    await expect(new HttpClient(policy, impl, noSleep).get(URL1)).rejects.toThrow(/https|Host no permitido/);
  });

  it('sigue redirecciones dentro de los hosts permitidos', async () => {
    const final = 'https://sites.google.com/final.kml';
    const { impl } = fakeFetch({ [URL1]: { status: 302, headers: { location: final } }, [final]: { body: '<kml/>' } });
    const r = await new HttpClient(policy, impl, noSleep).get(URL1);
    expect(r.finalUrl).toBe(final);
  });
});

describe('descargas fallidas o incompletas (caso 3)', () => {
  it('reintenta errores transitorios (500, red) y termina bien', async () => {
    const { impl, calls } = fakeFetch({ [URL1]: [{ status: 500 }, { error: 'ECONNRESET' }, { body: '<kml/>' }] });
    const r = await new HttpClient(policy, impl, noSleep).get(URL1);
    expect(r.intentos).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('no reintenta un 404 ni un 403', async () => {
    for (const status of [403, 404]) {
      const { impl, calls } = fakeFetch({ [URL1]: { status } });
      const err = await new HttpClient(policy, impl, noSleep).get(URL1).catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).transient).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it('los reintentos son limitados', async () => {
    const { impl, calls } = fakeFetch({ [URL1]: { status: 503 } });
    await expect(new HttpClient(policy, impl, noSleep).get(URL1)).rejects.toThrow(/503/);
    expect(calls).toHaveLength(policy.reintentos + 1);
  });

  it('detecta una descarga incompleta (Content-Length mayor que lo recibido)', async () => {
    const { impl } = fakeFetch({ [URL1]: { body: '<kml>', headers: { 'content-length': '500' } } });
    await expect(new HttpClient({ ...policy, reintentos: 0 }, impl, noSleep).get(URL1)).rejects.toThrow(/incompleta/);
  });

  it('corta respuestas más grandes que el límite', async () => {
    const { impl } = fakeFetch({ [URL1]: { body: 'x'.repeat(5000) } });
    await expect(new HttpClient(policy, impl, noSleep).get(URL1)).rejects.toThrow(/demasiado grande/);
  });

  it('tiempo de espera agotado', async () => {
    const slow = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await expect(new HttpClient({ ...policy, timeoutMs: 20, reintentos: 0 }, slow, noSleep).get(URL1)).rejects.toThrow(/Tiempo de espera/);
  });

  it('toma el nombre de archivo de Content-Disposition', async () => {
    const { impl } = fakeFetch({
      [URL1]: { body: '<kml/>', headers: { 'content-disposition': `attachment; filename="1.PUENTE.kml"; filename*=UTF-8''1.PUENTE%20DE%20IXTLA.kml` } },
    });
    expect((await new HttpClient(policy, impl, noSleep).get(URL1)).fileName).toBe('1.PUENTE DE IXTLA.kml');
  });
});
