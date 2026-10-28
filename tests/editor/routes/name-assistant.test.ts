import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SiglasResponse } from '@protocol';
import { NameAssistant } from '../../../src/editor/routes/NameAssistant';
import type { NameActions, NameAnswer, NameView } from '../../../src/editor/routes/types';
import { reportsFor, type NameSubject } from '../../../src/editor/state/naming';

const MESSY = '5.-(3.-CIRCUNVALACION (COL. PABLO TORRES BURGOS)-TIERRA LARGA Y 12 DE OCTUBRE (BASE TACAMBRO-CIRCUNVALACIàN)';
const noop = () => {};
const on: NameActions = { close: noop, retry: noop, setRuta: noop, setSiglas: noop, use: noop, useAll: noop };

const subject = (over: Partial<NameSubject> = {}): NameSubject => ({
  id: 'a',
  letter: 'A',
  color: '#3b82f6',
  original: MESSY,
  actual: MESSY,
  inicio: { nombre: 'Tierra Larga', tipo: 'Colonia', municipio: 'Cuautla' },
  final: { nombre: '12 de Octubre', tipo: 'Colonia', municipio: 'Cuautla' },
  ...over,
});
const siglas = (lugar: string) => ({ 'Tierra Larga': 'TLARG', '12 de Octubre': '12OCT' })[lugar] ?? '';

const response = (ia: Partial<SiglasResponse['ia']> = {}): SiglasResponse => ({
  ruta: { codigo: 'R6O', fuente: 'config' },
  lugares: [],
  ia: { habilitada: true, usada: true, modelo: 'qwen3.5:4b', ms: 1200, descartes: [], ...ia },
});

const view = (answer: NameAnswer, s = subject()): NameView => ({
  answer,
  ruta: 'R6O',
  lugares: [
    { nombre: 'Tierra Larga', detalle: 'Colonia · Cuautla', siglas: 'TLARG', fuente: 'qwen' },
    { nombre: '12 de Octubre', detalle: 'Colonia · Cuautla', siglas: '12OCT', fuente: 'regla', nota: 'Qwen no dio siglas válidas: se usó la regla de siglas.' },
  ],
  trazos: [{ subject: s, report: reportsFor([s], { a: s.actual }, 'R6O', siglas).get('a') ?? null }],
});

const render = (v: NameView) => renderToString(createElement(NameAssistant, { view: v, on })).replace(/<!-- -->/g, '');

describe('NameAssistant', () => {
  it('mientras espera dice que busca las siglas, y si falla explica por qué y deja reintentar', () => {
    expect(render(view({ state: 'loading' }))).toContain('Buscando las siglas de las colonias');
    const html = render(view({ state: 'error', message: 'Este lote todavía no tiene reporte.' }));
    expect(html).toContain('Este lote todavía no tiene reporte.');
    expect(html).toContain('Volver a intentar');
  });

  it('compara el nombre desordenado con la propuesta y deja usar cada uno', () => {
    const html = render(view({ state: 'ok', response: response() }));
    expect(html).toContain('R6O-TLARG-12OCT');
    expect(html).toContain('La propuesta se acerca más al nombre ideal (6 de 6 contra 2 de 6).');
    expect(html).toContain('Qwen (qwen3.5:4b) propuso las siglas nuevas en 1.2 s');
    // el actual es el original: está en uso y no se repite; sólo la propuesta se puede usar
    expect(html).toContain('En uso');
    expect(html.match(/Usar este nombre/g)).toHaveLength(1);
    expect(html).toContain('TLARG');
    expect(html).toContain('propuestas por Qwen');
  });

  it('si el trazo ya tiene otro nombre, el original también se puede recuperar', () => {
    const s = subject({ actual: 'R6O-TLARG-12OCT' });
    const html = render(view({ state: 'ok', response: response() }, s));
    expect(html).toContain('En uso');
    expect(html.match(/Usar este nombre/g)).toHaveLength(1); // la propuesta es la que está en uso: sólo queda recuperar el original
  });

  it('sin IA lo dice, y sin colonia en un extremo pide el nombre a mano', () => {
    const off = render(view({ state: 'ok', response: response({ habilitada: false, usada: false, modelo: undefined, ms: undefined }) }));
    expect(off).toContain('La IA está desactivada');
    expect(off).not.toContain('Qwen no dio siglas válidas');

    const lost = render(view({ state: 'ok', response: response() }, subject({ final: null })));
    expect(lost).toContain('El final no cae en ninguna colonia: ponle el nombre a mano.');
  });

  it('muestra por qué Qwen falló y que se usó la regla', () => {
    const html = render(view({ state: 'ok', response: response({ usada: false, error: 'fetch failed' }) }));
    expect(html).toContain('Qwen no respondió (fetch failed)');
  });
});
