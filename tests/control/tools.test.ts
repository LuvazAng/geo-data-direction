import { describe, expect, it } from 'vitest';
import { controlToolStates, OFFLINE, type ControlFacts } from '../../src/control/tools';

const online: ControlFacts = { online: true, busy: false, paused: false, pending: 0 };
const lotes = { SUR: 12, ORIENTE: 0 };

describe('controlToolStates', () => {
  it('sin conexión todo queda apagado con el mismo motivo, que dice cómo arreglarlo', () => {
    const s = controlToolStates({ ...online, online: false, pending: 3 }, lotes);
    expect(s.pause).toEqual({ status: 'off', reason: OFFLINE });
    expect(s.runNext).toEqual({ status: 'off', reason: OFFLINE });
    expect(s.newChat).toEqual({ status: 'off', reason: OFFLINE });
    expect(s.updateSource.SUR).toEqual({ status: 'off', reason: OFFLINE });
    expect(s.enqueuePending.ORIENTE).toEqual({ status: 'off', reason: OFFLINE });
    expect(OFFLINE).toContain('npm run centro');
  });

  it('procesar la siguiente pide que haya algo en la cola', () => {
    expect(controlToolStates(online, lotes).runNext).toEqual({ status: 'off', reason: 'No hay ejecuciones esperando en la cola.' });
    expect(controlToolStates({ ...online, pending: 2 }, lotes).runNext).toEqual({ status: 'ready' });
  });

  it('pausar sirve en cualquier estado de la cola cuando hay conexión', () => {
    expect(controlToolStates(online, lotes).pause).toEqual({ status: 'ready' });
    expect(controlToolStates({ ...online, paused: true }, lotes).pause).toEqual({ status: 'ready' });
  });

  it('un lote sin rutas recomienda leer su fuente y no deja encolar pendientes', () => {
    const s = controlToolStates(online, lotes);
    expect(s.updateSource.ORIENTE).toEqual({ status: 'recommended', why: 'Este lote todavía no tiene su fuente leída.' });
    expect(s.enqueuePending.ORIENTE.status).toBe('off');
    expect(s.updateSource.SUR).toEqual({ status: 'ready' });
    expect(s.enqueuePending.SUR).toEqual({ status: 'ready' });
  });

  it('nuevo chat espera a que termine lo que se está haciendo', () => {
    expect(controlToolStates({ ...online, busy: true }, lotes).newChat.status).toBe('off');
    expect(controlToolStates(online, lotes).newChat).toEqual({ status: 'ready' });
  });

  it('hay una entrada por cada lote', () => {
    const s = controlToolStates(online, lotes);
    expect(Object.keys(s.updateSource).sort()).toEqual(['ORIENTE', 'SUR']);
    expect(Object.keys(s.enqueuePending).sort()).toEqual(['ORIENTE', 'SUR']);
  });
});
