import { useEffect, useMemo, useState } from 'react';
import { Fold, Icon, Popover, Term } from '@ui';
import type { Job, RouteStatus } from '@protocol';
import { api } from '../api';
import { Badge, ConfirmButton, JobBadge, jobTitle, ROUTE_LABEL, routeTone, time } from '../common';
import { define } from '../glossary';
import { OFFLINE } from '../tools';
import type { Centro } from '../useCentro';

const GROUPS: RouteStatus[] = ['sin-procesar', 'incompleta', 'con-errores', 'con-revision', 'procesada'];

export function QueueView({ centro, online, openJob }: { centro: Centro; online: boolean; openJob: (id: string) => void }) {
  const { state, call, busy } = centro;
  const [lote, setLote] = useState(state.lotes[0]?.lote ?? '');
  const [ruta, setRuta] = useState('');
  const [sinRed, setSinRed] = useState(false);
  const [sinIa, setSinIa] = useState(false);
  useEffect(() => {
    if (!lote && state.lotes[0]) setLote(state.lotes[0].lote);
  }, [state.lotes, lote]);

  const pending = state.cola.orden.map((id) => state.jobs[id]).filter((j): j is Job => !!j);
  const rutas = useMemo(() => state.rutas.filter((u) => u.lote === lote), [state.rutas, lote]);
  const disabled = !online || busy;

  const move = (i: number, d: -1 | 1) => {
    const ids = [...state.cola.orden];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void call(() => api.reorder(ids));
  };

  const enqueue = (opts: { primero?: boolean; iniciar?: boolean }) =>
    ruta && void call(() => api.enqueue({ lote, ruta, ...opts, parametros: { sinRed, sinIa }, clave: `ui-${lote}-${ruta}-${Date.now()}` }));

  return (
    <div className="cc-queue">
      <section className="cc-card cc-add">
        <h3>Agregar a la cola</h3>
        <div className="cc-add-row">
          <label className="cc-field">
            <span className="small muted">
              <Term definition={define('lote')}>Lote</Term>
            </span>
            <select value={lote} onChange={(e) => (setLote(e.target.value), setRuta(''))} disabled={disabled}>
              {state.lotes.map((l) => (
                <option key={l.lote} value={l.lote}>
                  {l.lote}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-field grow">
            <span className="small muted">Ruta</span>
            <select value={ruta} onChange={(e) => setRuta(e.target.value)} disabled={disabled || rutas.length === 0}>
              <option value="">{rutas.length ? 'Elige una ruta…' : 'Sin rutas: actualiza la fuente en Herramientas'}</option>
              {rutas.map((u) => (
                <option key={u.slug} value={u.slug} disabled={!!u.jobActivo}>
                  {u.titulo} — {ROUTE_LABEL[u.estado]}
                  {u.jobActivo ? ' (ya en cola)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={disabled || !ruta} onClick={() => enqueue({})} title="Se agrega al final de la cola">
            <Icon name="plus" /> Agregar a la cola
          </button>
        </div>
        {!online && <p className="small warn-text">{OFFLINE}</p>}
        <Fold title="Más opciones">
          <p className="small muted">Por omisión la ruta se agrega al final de la cola y se procesa con red y con Qwen.</p>
          <div className="row">
            <label className="check small" title="Reprocesa con los originales que ya están descargados">
              <input type="checkbox" checked={sinRed} onChange={(e) => setSinRed(e.target.checked)} /> sin red
            </label>
            <label className="check small" title="No consultar a Qwen: sólo reglas">
              <input type="checkbox" checked={sinIa} onChange={(e) => setSinIa(e.target.checked)} /> sin IA
            </label>
          </div>
          <div className="row">
            <button disabled={disabled || !ruta} onClick={() => enqueue({ primero: true })} title="La pone al frente de la cola, para cuando termine la actual">
              Agregar como siguiente
            </button>
            <button disabled={disabled || !ruta} onClick={() => enqueue({ primero: true, iniciar: true })} title="La inicia ya si hay capacidad">
              Procesar ahora
            </button>
          </div>
        </Fold>
      </section>

      <h3>En cola ({pending.length})</h3>
      <p className="small muted">
        {state.cola.pausada
          ? 'La cola está en pausa: sólo se ejecuta lo que pidas a mano.'
          : 'La cola está activa: toma la siguiente cuando termina la actual.'}{' '}
        Máximo {state.cola.maxSimultaneas} a la vez; un lote, una ejecución. Pausarla o procesar la siguiente está en Herramientas.
      </p>
      {pending.length === 0 && <p className="muted small">No hay ejecuciones esperando.</p>}
      <ol className="cc-queue-list">
        {pending.map((j, i) => (
          <li key={j.id} className="cc-card">
            <span className="cc-pos">{i + 1}</span>
            <div className="cc-grow">
              <button className="link" onClick={() => openJob(j.id)}>
                <b>{jobTitle(j)}</b> <span className="small muted">{j.lote}</span>
              </button>
              <div className="small muted">
                en cola desde {time(j.encoladoEn)} · desde {j.origen}
                {j.parametros.sinRed && ' · sin red'}
                {j.parametros.sinIa && ' · sin IA'}
                {j.reintentoDe && ` · reintento de ${j.reintentoDe}`}
              </div>
            </div>
            <JobBadge job={j} />
            <div className="row">
              <button
                className="compact"
                disabled={disabled}
                onClick={() => void call(() => api.start(j.id))}
                title="Inicia ya si hay capacidad; si no, la deja al frente"
              >
                <Icon name="play" size={14} /> Iniciar
              </button>
              <Popover menu className="icon" icon="more" label="" title="Más acciones de esta ejecución" disabled={disabled}>
                {(close) => (
                  <>
                    <button
                      className="pop-item"
                      disabled={i === 0}
                      onClick={() => {
                        move(i, -1);
                        close();
                      }}
                    >
                      <Icon name="arrow-up" /> Subir en la cola
                    </button>
                    <button
                      className="pop-item"
                      disabled={i === pending.length - 1}
                      onClick={() => {
                        move(i, 1);
                        close();
                      }}
                    >
                      <Icon name="arrow-down" /> Bajar en la cola
                    </button>
                    <button
                      className="pop-item"
                      disabled={i === 0}
                      onClick={() => {
                        void call(() => api.first(j.id));
                        close();
                      }}
                    >
                      Poner al frente
                    </button>
                    <ConfirmButton
                      className="pop-item"
                      onConfirm={() => {
                        void call(() => api.cancel(j.id));
                        close();
                      }}
                    >
                      Quitar de la cola
                    </ConfirmButton>
                  </>
                )}
              </Popover>
            </div>
          </li>
        ))}
      </ol>

      <h3>Rutas de {lote || '—'}</h3>
      {rutas.length === 0 && <p className="muted small">Este lote todavía no tiene la fuente leída. Usa «Actualizar la fuente» en Herramientas.</p>}
      {GROUPS.map((g) => {
        const items = rutas.filter((u) => u.estado === g);
        if (!items.length) return null;
        return (
          <details key={g} open={g !== 'procesada'} className="cc-route-group">
            <summary>
              <Badge tone={routeTone(g)}>{ROUTE_LABEL[g]}</Badge> {items.length}
            </summary>
            <table className="cc-table">
              <tbody>
                {items.map((u) => (
                  <tr key={u.slug}>
                    <td>{u.titulo}</td>
                    <td className="small muted">
                      {u.mapas} mapa(s) ·{' '}
                      {Object.entries(u.conteo)
                        .map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`)
                        .join(', ')}
                    </td>
                    <td>
                      {u.jobActivo ? (
                        <button className="link" onClick={() => openJob(u.jobActivo!)}>
                          en cola / en curso
                        </button>
                      ) : (
                        <button
                          className="compact"
                          disabled={disabled}
                          onClick={() => void call(() => api.enqueue({ lote, ruta: u.slug, clave: `ui-${lote}-${u.slug}-${Date.now()}` }))}
                        >
                          Encolar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </div>
  );
}
