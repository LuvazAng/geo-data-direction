import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SiglasResponse } from '@protocol';
import type { LoteInfo } from '../../../src/orchestrator/config';
import { QwenClient } from '../../../src/orchestrator/llm/llm';
import { derivesFrom, validateSiglas } from '../../../src/orchestrator/llm/siglas';
import { suggestSiglas } from '../../../src/orchestrator/server/nombres';
import { testConfig, tmp } from '../../helpers';
import { makeCenter, startServer, testLote } from './helpers';

const IA = { ...testConfig(tmp()).ia, habilitada: true, reintentos: 0 };

/** Un Qwen simulado: responde lo que se le diga (o falla) y cuenta cuántas veces se le preguntó. */
function fakeQwen(answer: unknown) {
  const calls = { n: 0 };
  const client = new QwenClient(IA, { get: () => undefined, set: () => {} }, async () => {
    calls.n++;
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { headers: { 'content-type': 'application/json' } });
  });
  return { client, calls };
}

const rutas = [{ slug: 'ruta-6b-oriente', codigo: 'R6BO', carpeta: 'RUTA-6B-ORIENTE', origen: 'regla' as const }];

/** Escribe el reporte y el catálogo aprendido del lote, como los deja el orquestador. */
function writeData(lote: LoteInfo, opts: { sugeridos?: { nombre: string; codigo: string }[]; aprendidos?: Record<string, string>; sinReporte?: boolean } = {}) {
  mkdirSync(lote.raiz, { recursive: true });
  rmSync(join(lote.raiz, 'reporte.json'), { force: true });
  if (!opts.sinReporte) {
    const report = {
      trazos: [{ id: 'T1', ruta: 'ruta-6b-oriente' }],
      paginas: [],
      codigos: { rutas, sugeridos: opts.sugeridos ?? [], viasSugeridas: [], conflictos: [] },
    };
    writeFileSync(join(lote.raiz, 'reporte.json'), JSON.stringify(report));
  }
  writeFileSync(join(lote.raiz, 'catalogo-aprendido.json'), JSON.stringify({ localidades: { codigos: opts.aprendidos ?? {}, conflictos: [] }, vias: {} }));
}

const req = (lugares: string[]) => ({ lote: 'PRUEBA', traza: 'T1', lugares: lugares.map((nombre) => ({ nombre, tipo: 'Colonia', municipio: 'Cuautla' })) });
const siglasOf = (r: SiglasResponse) => Object.fromEntries(r.lugares.map((l) => [l.nombre, `${l.siglas}:${l.fuente}`]));

describe('siglas de los lugares de un trazo', () => {
  let lote: LoteInfo;
  beforeAll(() => {
    lote = testLote(tmp('siglas-'));
  });

  it('un lugar que el catálogo ya conoce lleva sus siglas y no se le pregunta a Qwen', async () => {
    writeData(lote, { sugeridos: [{ nombre: 'TORRES BURGOS', codigo: 'TBUR' }], aprendidos: { JOJUTLA: 'JOJU' } });
    const q = fakeQwen({ siglas: [] });
    const r = await suggestSiglas(lote, q.client, req(['Torres Burgos', 'Jojutla']));
    expect(siglasOf(r)).toEqual({ 'Torres Burgos': 'TBUR:sugerido', Jojutla: 'JOJU:aprendido' });
    expect(r.ruta).toEqual({ codigo: 'R6BO', fuente: 'regla' });
    expect(q.calls.n).toBe(0);
    expect(r.ia.usada).toBe(false);
  });

  it('la configuración manda sobre lo aprendido', async () => {
    writeData(lote, { aprendidos: { JOJUTLA: 'JOJ' } });
    const conConfig = { ...lote, config: { ...lote.config, nomenclatura: { ...lote.config.nomenclatura, localidades: { JOJUTLA: 'JOJU' } } } };
    const r = await suggestSiglas(conConfig, null, req(['Jojutla']));
    expect(siglasOf(r)).toEqual({ Jojutla: 'JOJU:config' });
  });

  it('lo que el catálogo no conoce se lo pregunta a Qwen y usa sus siglas válidas', async () => {
    writeData(lote);
    const q = fakeQwen({
      siglas: [
        { lugar: 'Tierra Larga', siglas: 'tlarg' },
        { lugar: '12 de Octubre', siglas: '12OCT' },
      ],
    });
    const r = await suggestSiglas(lote, q.client, req(['Tierra Larga', '12 de Octubre']));
    expect(siglasOf(r)).toEqual({ 'Tierra Larga': 'TLARG:qwen', '12 de Octubre': '12OCT:qwen' });
    expect(q.calls.n).toBe(1);
    expect(r.ia).toMatchObject({ habilitada: true, usada: true, descartes: [] });
  });

  it('descarta las siglas de Qwen que no salen del nombre, que ya son de otro lugar o que no son siglas, y usa la regla', async () => {
    writeData(lote, { sugeridos: [{ nombre: 'CASAS DEL RIO', codigo: 'CRIO' }] });
    const q = fakeQwen({
      siglas: [
        { lugar: 'Tierra Larga', siglas: 'ZZZZ' }, // no sale del nombre
        { lugar: 'Cruz Rio', siglas: 'CRIO' }, // sale del nombre, pero ya es de otro lugar
        { lugar: 'Hospital', siglas: 'HOSPITAL' }, // demasiado larga
        { lugar: 'Inventado', siglas: 'INV' }, // no se pidió
      ],
    });
    const r = await suggestSiglas(lote, q.client, req(['Tierra Larga', 'Cruz Rio', 'Hospital']));
    expect(siglasOf(r)).toEqual({ 'Tierra Larga': 'TLARG:regla', 'Cruz Rio': 'CRIO2:regla', Hospital: 'HOSPI:regla' });
    expect(r.ia.descartes.join(' | ')).toMatch(/ZZZZ.*no sale de su nombre/);
    expect(r.ia.descartes.join(' | ')).toMatch(/CRIO.*ya es de otro lugar/);
    expect(r.ia.descartes.join(' | ')).toMatch(/HOSPITAL.*no son de 2 a 6/);
    expect(r.ia.descartes.join(' | ')).toMatch(/Inventado.*no es uno de los lugares pedidos/);
    expect(r.lugares.every((l) => l.nota?.includes('Qwen no dio siglas válidas'))).toBe(true);
  });

  it('sin IA configurada usa la regla y lo dice', async () => {
    writeData(lote);
    const r = await suggestSiglas(lote, null, req(['Tierra Larga']));
    expect(r.lugares[0]).toMatchObject({ siglas: 'TLARG', fuente: 'regla', nota: 'La IA está desactivada: se usó la regla de siglas.' });
    expect(r.ia).toMatchObject({ habilitada: false, usada: false });
  });

  it('si Qwen no responde usa la regla y deja el error en la respuesta', async () => {
    writeData(lote);
    const q = fakeQwen(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    const r = await suggestSiglas(lote, q.client, req(['Tierra Larga', '12 de Octubre']));
    expect(siglasOf(r)).toEqual({ 'Tierra Larga': 'TLARG:regla', '12 de Octubre': '12OCT:regla' });
    expect(r.ia.usada).toBe(false);
    expect(r.ia.error).toMatch(/ECONNREFUSED/);
    expect(r.lugares[0].nota).toMatch(/Qwen no respondió/);
  });

  it('si las siglas de la regla ya son de otro lugar, usa unas libres', async () => {
    writeData(lote, { sugeridos: [{ nombre: 'PABLO TORRES', codigo: 'PTBUR' }] });
    const r = await suggestSiglas(lote, null, req(['Pablo Torres Burgos']));
    expect(r.lugares[0].siglas).toBe('PTBURG');
  });

  it('dos lugares con las mismas siglas no se pisan entre sí', async () => {
    writeData(lote);
    const r = await suggestSiglas(lote, null, req(['Tierra Larga', 'Tierra Larga Norte', 'Tienda Larga']));
    const codes = r.lugares.map((l) => l.siglas);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{2,6}$/);
  });

  it('un lugar repetido en la petición aparece una sola vez', async () => {
    writeData(lote);
    const r = await suggestSiglas(lote, null, req(['Tierra Larga', 'Tierra Larga']));
    expect(r.lugares).toHaveLength(1);
  });

  it('sin reporte o con un trazo desconocido responde con un error claro', async () => {
    writeData(lote, { sinReporte: true });
    await expect(suggestSiglas(lote, null, req(['Tierra Larga']))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no tiene reporte/) });
    writeData(lote);
    await expect(suggestSiglas(lote, null, { ...req(['Tierra Larga']), traza: 'otro' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('derivesFrom', () => {
  it('las siglas salen del nombre: en orden y empezando como una palabra, con los números como cifras', () => {
    expect(derivesFrom('TLARG', 'Tierra Larga')).toBe(true);
    expect(derivesFrom('12OCT', '12 de Octubre')).toBe(true);
    expect(derivesFrom('PTBUR', 'Pablo Torres Burgos')).toBe(true);
    expect(derivesFrom('ZZZZ', 'Tierra Larga')).toBe(false);
    // las letras están, pero no en orden
    expect(derivesFrom('LTARG', 'Tierra Larga')).toBe(false);
    // en orden, pero no empieza como ninguna palabra
    expect(derivesFrom('IERRA', 'Tierra Larga')).toBe(false);
  });
});

describe('validateSiglas', () => {
  const q = { lugares: [{ nombre: 'Tierra Larga' }], ejemplos: [], ocupadas: [] };

  it('rechaza una respuesta sin la lista de siglas', () => {
    expect(() => validateSiglas({ otra: 1 }, q)).toThrow(/siglas/);
  });

  it('compara el lugar sin importar mayúsculas ni acentos y devuelve el nombre tal como se pidió', () => {
    const { siglas } = validateSiglas({ siglas: [{ lugar: 'TIERRA LARGA', siglas: 'TLARG' }] }, q);
    expect([...siglas]).toEqual([['Tierra Larga', 'TLARG']]);
  });
});

describe('POST /api/nombres/siglas', () => {
  let ctx: ReturnType<typeof makeCenter>;
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    ctx = makeCenter();
    ctx.center.jobs.pause();
    writeData(ctx.lotes[0]);
    srv = await startServer(ctx.center);
  });
  afterAll(async () => {
    await srv.close();
    await ctx.center.close();
  });

  const post = (body: unknown) => srv.req('/api/nombres/siglas', { method: 'POST', body: JSON.stringify(body) });

  it('responde con la ruta y las siglas (sin IA: la regla)', async () => {
    const res = await post(req(['Tierra Larga', '12 de Octubre']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiglasResponse;
    expect(body.ruta.codigo).toBe('R6BO');
    expect(siglasOf(body)).toEqual({ 'Tierra Larga': 'TLARG:regla', '12 de Octubre': '12OCT:regla' });
  });

  it('deja constancia en la consola del centro', async () => {
    await post(req(['Tierra Larga']));
    const line = ctx.center.logs.recent().find((l) => l.componente === 'QWEN' && /Siglas de R6BO/.test(l.mensaje));
    expect(line?.mensaje).toMatch(/Tierra Larga → TLARG \(regla\)/);
  });

  it('valida lo que recibe', async () => {
    expect((await post({ ...req(['x']), lote: 'NO-EXISTE' })).status).toBeGreaterThanOrEqual(400);
    expect((await post({ lote: 'PRUEBA', lugares: [{ nombre: 'x' }] })).status).toBe(400);
    expect((await post({ lote: 'PRUEBA', traza: 'T1', lugares: [] })).status).toBe(400);
    expect((await post({ lote: 'PRUEBA', traza: 'T1', lugares: [{ nombre: '' }] })).status).toBe(400);
    expect((await post({ lote: 'PRUEBA', traza: 'T1', lugares: [{ nombre: 'x'.repeat(121) }] })).status).toBe(400);
    expect((await post({ lote: 'PRUEBA', traza: 'T1', lugares: Array.from({ length: 13 }, (_, i) => ({ nombre: `Colonia ${i}` })) })).status).toBe(400);
  });

  it('exige el token como el resto de la API', async () => {
    const res = await fetch(`${srv.base}/api/nombres/siglas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req(['x'])),
    });
    expect(res.status).toBe(401);
  });
});
