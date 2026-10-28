import { describe, expect, it } from 'vitest';
import { type Coord, lengthKm } from '@core';
import { candidatePairs, pairMetrics, type Line } from '../../../src/orchestrator/domain/similarity';
import { JOJUTLA, line, path, PUENTE_IXTLA, shift, testConfig, tmp } from '../../helpers';

const T = testConfig(tmp()).similitud;
const L = (id: string, coords: Coord[]): Line => ({ id, coords, lengthM: lengthKm(coords) * 1000 });

const MID: Coord = [-99.25, 18.64];
const base = path(JOJUTLA, MID, PUENTE_IXTLA);

describe('comparación geoespacial', () => {
  it('trazos idénticos (caso 6)', () => {
    const m = pairMetrics(L('a', base), L('b', [...base]), T);
    expect(m.clase).toBe('identico');
    expect(m.similitud).toBe(1);
    expect(m.sentido).toBe('mismo');
    expect(m.distanciaMediaM).toBe(0);
  });

  it('misma geometría con el orden invertido (caso 7)', () => {
    const m = pairMetrics(L('a', base), L('b', [...base].reverse()), T);
    expect(m.clase).toBe('identico-invertido');
    expect(m.sentido).toBe('opuesto');
    expect(m.similitud).toBe(1);
  });

  it('pequeñas diferencias de GPS: casi idéntico, en ambos sentidos', () => {
    const noisy = shift(base, 8);
    expect(pairMetrics(L('a', base), L('b', noisy), T).clase).toBe('casi-identico');
    const back = pairMetrics(L('a', base), L('b', [...noisy].reverse()), T);
    expect(back.clase).toBe('casi-identico-invertido');
    expect(back.distanciaMediaM).toBeGreaterThan(5);
    expect(back.distanciaMediaM).toBeLessThan(10);
  });

  it('recorridos parcialmente coincidentes (caso 8)', () => {
    // comparten Jojutla → MID, después se separan
    const other = path(JOJUTLA, MID, [-99.25, 18.75]);
    const m = pairMetrics(L('a', base), L('b', other), T);
    expect(m.clase).toBe('parcial');
    expect(m.similitud).toBeGreaterThan(0.3);
    expect(m.similitud).toBeLessThan(0.7);
    expect(m.longitudCompartidaM).toBeGreaterThan(5000);
  });

  it('un tramo corto encima de una ruta larga es "contenido"', () => {
    const short = line(JOJUTLA, MID);
    const m = pairMetrics(L('corto', short), L('largo', base), T);
    expect(m.clase).toBe('contenido');
    expect(m.coberturaAB).toBeGreaterThan(0.95);
    expect(m.coberturaBA).toBeLessThan(0.6);
  });

  it('trazos sin relación', () => {
    const far = shift(base, 3000);
    expect(pairMetrics(L('a', base), L('b', far), T).clase).toBe('distinto');
  });

  it('el resultado es reproducible (mismas entradas → mismos números)', () => {
    const a = L('a', base);
    const b = L('b', shift(path(JOJUTLA, [-99.24, 18.65], PUENTE_IXTLA), 12));
    expect(JSON.stringify(pairMetrics(a, b, T))).toBe(JSON.stringify(pairMetrics(a, b, T)));
  });
});

describe('índice de celdas', () => {
  it('sólo propone pares que comparten zona', () => {
    const lines = [L('a', base), L('b', [...base].reverse()), L('c', shift(base, 20_000))];
    const pairs = candidatePairs(lines, 150, 0.2).map(([x, y]) => `${x.id}-${y.id}`);
    expect(pairs).toEqual(['a-b']);
  });
});
