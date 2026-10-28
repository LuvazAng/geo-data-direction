import { useEffect, useState } from 'react';
import { Icon } from '@ui';
import type { AddrState, Route } from '../services/route';
import { onewayOf } from '../services/route';
import { onewayVerdict, streetsSummary } from '../services/oneway';
import { formatAddress } from '../services/geocode';
import type { ColoniasView } from './types';

export const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const streetList = (list: [string, number][]) =>
  list
    .slice(0, 3)
    .map(([name, m]) => `${name} (${km(m)})`)
    .join(', ');

export const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export const Spinner = () => <span className="spinner" aria-hidden="true" />;

/** Tiempo transcurrido (m:ss), se actualiza cada segundo. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="muted">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

/** Dirección de un extremo del trazo. */
export function Addr({ a }: { a?: AddrState }) {
  if (!a || a.state === 'loading') return <span className="muted">buscando dirección…</span>;
  if (a.state === 'error') return <span className="muted">sin dirección ({a.message})</span>;
  return <span>{formatAddress(a.address) || a.address.full.split(' | ')[0]}</span>;
}

/** Si el trazo respeta las calles de un solo sentido de OpenStreetMap. */
export function Oneways({ route, onRetry }: { route: Route; onRetry: () => void }) {
  const state = route.oneway;
  if (state?.state === 'error')
    return (
      <div className="small muted">
        No se pudo consultar las calles de un sentido ({state.message}){' '}
        <button className="link" onClick={onRetry}>
          reintentar
        </button>
      </div>
    );
  const r = onewayOf(route);
  if (!r)
    return (
      <div className="small muted loading-line">
        <Spinner /> Consultando calles de un sentido (OpenStreetMap)…
      </div>
    );
  const verdict = onewayVerdict(r);
  const favor = `${km(r.agreeM)} a favor · ${km(r.againstM)} en contra`;
  if (verdict === 'sin-datos') return <div className="small muted">Calles de un sentido: el trazo casi no pasa por ninguna (sin datos en OpenStreetMap).</div>;
  if (verdict === 'correcto')
    return (
      <div className="hint ok" title={streetList(streetsSummary(r, true))}>
        <Icon name="check" size={14} />
        <div>Respeta las calles de un sentido: {favor}</div>
      </div>
    );
  return (
    <div className={`hint ${verdict === 'invertido' ? 'warn' : 'mixed'}`}>
      <Icon name={verdict === 'invertido' ? 'alert' : 'info'} size={14} />
      <div>
        {verdict === 'invertido' ? 'Va en contra de las calles de un sentido' : 'Sentido mixto en calles de un sentido'}: {favor}
        <div className="small">En contra: {streetList(streetsSummary(r, false))}</div>
      </div>
    </div>
  );
}

/** Lista de colonias por las que pasa el trazo, en orden de recorrido. */
export function ColoniasList({ view }: { view?: ColoniasView }) {
  if (!view || view.state === 'loading')
    return (
      <div className="small muted loading-line">
        <Spinner /> Cargando colonias…
      </div>
    );
  if (view.state === 'error') return <div className="small muted">Colonias: {view.message}. Al guardar no se escriben en el KML.</div>;
  const { pasos, fueraM } = view.result;
  const fuera = fueraM >= 100 && <span className="muted"> · {km(fueraM)} fuera de colonias</span>;
  if (pasos.length === 0) return <div className="small muted">No pasa por ninguna colonia{fuera}.</div>;
  return (
    <>
      <ol className="colonias-list">
        {pasos.map((p) => (
          <li key={p.ids.join('-')} title={p.colonia.cp && `C.P. ${p.colonia.cp}`}>
            {p.colonia.nombre} <span className="muted">{[p.colonia.tipo, p.colonia.municipio, km(p.metros)].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ol>
      <div className="small muted">Fuente: INE. Se guardan en el KML (campo COLONIAS).{fuera}</div>
    </>
  );
}

/** Cuántas colonias hay que mostrar junto al título de la sección (si ya se sabe). */
export function coloniasCount(view?: ColoniasView): number | undefined {
  return view?.state === 'ok' ? view.result.pasos.length : undefined;
}
