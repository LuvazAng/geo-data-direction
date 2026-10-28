import { useEffect, useMemo, useState } from 'react';
import type { Job, RouteStatus } from '@protocol';
import { api } from './api';
import { Badge, ConfirmButton, JobBadge, jobTitle, ROUTE_LABEL, routeTone, time } from './common';
import type { Centro } from './useCentro';

const GROUPS: RouteStatus[] = ['sin-procesar', 'incompleta', 'con-errores', 'con-revision', 'procesada'];

export function QueueView({ centro, online, openJob }: { centro: Centro; online: boolean; openJob: (id: string) => void }) {
  const { state, call, act, busy } = centro;
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
      <section className="cc-card">
        <div className="row">
          <button
            className="primary"
            disabled={disabled || pending.length === 0}
            onClick={() => void act({ tipo: 'ejecutar-siguiente' })}
            title="Funciona aunque la cola esté en pausa"
          >
            Procesar la siguiente
          </button>
          {state.cola.pausada ? (
            <button disabled={disabled} onClick={() => void call(api.resume)}>
              ▶ Reanudar la cola
            </button>
          ) : (
            <button disabled={disabled} onClick={() => void call(api.pause)} title="No se toman ejecuciones nuevas; la que está en curso termina normalmente">
              ⏸ Pausar la cola
            </button>
          )}
          <span className="small muted">
            {state.cola.pausada ? 'En pausa: sólo se ejecuta lo que pidas a mano.' : 'Activa: toma la siguiente cuando termina la actual.'} Máximo{' '}
            {state.cola.maxSimultaneas} a la vez; un lote, una ejecución.
          </span>
        </div>
        <div className="row cc-add">
          <select value={lote} onChange={(e) => (setLote(e.target.value), setRuta(''))} disabled={disabled}>
            {state.lotes.map((l) => (
              <option key={l.lote} value={l.lote}>
                {l.lote}
              </option>
            ))}
          </select>
          <select value={ruta} onChange={(e) => setRuta(e.target.value)} disabled={disabled || rutas.length === 0}>
            <option value="">{rutas.length ? 'Elige una ruta…' : 'Sin rutas: actualiza la fuente'}</option>
            {rutas.map((u) => (
              <option key={u.slug} value={u.slug} disabled={!!u.jobActivo}>
                {u.titulo} — {ROUTE_LABEL[u.estado]}
                {u.jobActivo ? ' (ya en cola)' : ''}
              </option>
            ))}
          </select>
          <label className="check small">
            <input type="checkbox" checked={sinRed} onChange={(e) => setSinRed(e.target.checked)} /> sin red
          </label>
          <label className="check small" title="No consultar a Qwen (sólo reglas)">
            <input type="checkbox" checked={sinIa} onChange={(e) => setSinIa(e.target.checked)} /> sin IA
          </label>
          <button disabled={disabled || !ruta} onClick={() => enqueue({})}>
            Agregar al final
          </button>
          <button disabled={disabled || !ruta} onClick={() => enqueue({ primero: true })}>
            Como siguiente
          </button>
          <button className="primary" disabled={disabled || !ruta} onClick={() => enqueue({ primero: true, iniciar: true })}>
            Procesar ahora
          </button>
        </div>
        <div className="row">
          <button disabled={disabled || !lote} onClick={() => void act({ tipo: 'encolar-pendientes', lote })}>
            Encolar todas las pendientes de {lote}
          </button>
          <button
            disabled={disabled || !lote}
            onClick={() => void act({ tipo: 'actualizar-fuente', lote })}
            title="Lee de nuevo la página de la zona y sus subpáginas (no descarga mapas)"
          >
            Actualizar fuente de {lote}
          </button>
        </div>
      </section>

      <h3>En cola ({pending.length})</h3>
      {pending.length === 0 && <p className="muted small">No hay ejecuciones pendientes.</p>}
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
              <button className="icon" title="Subir" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon" title="Bajar" disabled={disabled || i === pending.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button disabled={disabled || i === 0} onClick={() => void call(() => api.first(j.id))}>
                Al frente
              </button>
              <button disabled={disabled} onClick={() => void call(() => api.start(j.id))} title="Inicia ya si hay capacidad; si no, la deja al frente">
                Iniciar
              </button>
              <ConfirmButton disabled={disabled} onConfirm={() => void call(() => api.cancel(j.id))}>
                Quitar
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ol>

      <h3>Rutas de {lote || '—'}</h3>
      {rutas.length === 0 && <p className="muted small">Este lote todavía no tiene la fuente leída. Usa «Actualizar fuente».</p>}
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
