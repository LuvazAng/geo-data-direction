import { useMemo, useState } from 'react';
import { lengthKm, simplify } from '@core';
import { baseCoords, coordsOf, type Route } from '../services/route';
import { MAX_SNAP_M } from '../services/snap';
import { Elapsed, Spinner } from './parts';
import type { RouteActions, ShapeToolId, SnapView } from './types';

interface Props {
  tool: ShapeToolId;
  route: Route;
  snap?: SnapView;
  on: RouteActions;
}

/** La herramienta de forma que está activa en el trazo: aparece sólo mientras se usa. */
export function ShapeTool({ tool, route, snap, on }: Props) {
  return (
    <section className="shape-tool" aria-live="polite">
      {tool === 'edit' ? (
        <EditTool route={route} on={on} />
      ) : tool === 'simplify' ? (
        <SimplifyTool route={route} on={on} />
      ) : (
        <SnapTool route={route} snap={snap} on={on} />
      )}
    </section>
  );
}

function pointsLine(route: Route) {
  const points = baseCoords(route).length;
  const original = route.parsed.coords.length;
  return (
    <p className="small">
      <b>{points}</b> puntos{points !== original && <span className="muted"> (el archivo tenía {original})</span>}
    </p>
  );
}

function EditTool({ route, on }: { route: Route; on: RouteActions }) {
  return (
    <>
      <h3>Editando vértices</h3>
      <p className="small muted">
        Arrastra un vértice (amarillo) para moverlo y un punto medio (blanco) para agregar uno; clic derecho quita uno. Acerca el mapa para verlos.
      </p>
      {pointsLine(route)}
      <div className="row">
        <button onClick={on.undo} disabled={!route.history?.length} title="Ctrl+Z">
          Deshacer
        </button>
        <button onClick={on.restore} disabled={!route.edited} title="Vuelve a la geometría que traía el archivo">
          Restaurar
        </button>
        <span className="spacer" />
        <button className="primary" onClick={on.toggleEdit} title="E o Esc">
          Terminar edición
        </button>
      </div>
    </>
  );
}

function SimplifyTool({ route, on }: { route: Route; on: RouteActions }) {
  const [tol, setTol] = useState(5);
  const base = baseCoords(route);
  const preview = useMemo(() => simplify(base, tol).length, [base, tol]);
  return (
    <>
      <h3>Simplificar</h3>
      <p className="small muted">Quita los puntos que sobran sin mover el trazo más que la desviación elegida. Siempre conserva el primer y el último punto.</p>
      {pointsLine(route)}
      <div className="row">
        <input
          type="range"
          className="grow"
          min={0.5}
          max={20}
          step={0.5}
          value={tol}
          onChange={(e) => setTol(Number(e.target.value))}
          aria-label="Desviación máxima en metros"
        />
        <span className="small">
          ≤ {tol} m → <b>{preview}</b> puntos
        </span>
      </div>
      <div className="row">
        <span className="spacer" />
        <button onClick={on.simplifyClose}>Cancelar</button>
        <button
          className="primary"
          onClick={() => {
            on.simplify(tol);
            on.simplifyClose();
          }}
          disabled={preview >= base.length}
        >
          Aplicar
        </button>
      </div>
    </>
  );
}

function SnapTool({ route, snap, on }: { route: Route; snap?: SnapView; on: RouteActions }) {
  const title = <h3>Ajustar a calles</h3>;
  if (!snap) return title;

  const margin = (
    <div className="row">
      <span className="small muted" title="Las partes del trazo más lejos que esto de una calle se quedan como están">
        Margen
      </span>
      <input
        type="range"
        className="grow"
        min={5}
        max={MAX_SNAP_M}
        step={5}
        value={snap.maxDist}
        onChange={(e) => on.snapDistance(Number(e.target.value))}
        aria-label="Distancia máxima a una calle en metros"
      />
      <span className="small">
        ≤ <b>{snap.maxDist} m</b> de la calle
      </span>
    </div>
  );

  if (snap.state === 'loading') {
    const { progress } = snap;
    return (
      <>
        {title}
        {margin}
        <div className="small loading-line" role="status">
          <Spinner />
          <span>
            {!progress
              ? 'En espera de otra descarga de calles…'
              : progress.total === 0
                ? 'Preparando calles…'
                : `Descargando calles de OpenStreetMap · parte ${Math.min(progress.done + 1, progress.total)} de ${progress.total}`}
          </span>
          <span className="spacer" />
          <Elapsed since={snap.since} />
        </div>
        {progress && progress.total > 0 && (
          <div className="meter">
            <div style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }} />
          </div>
        )}
        <p className="small muted">La primera vez en una zona puede tardar de 30 a 120 s; después queda en caché.</p>
        <div className="row">
          <span className="spacer" />
          <button onClick={on.snapCancel}>Cancelar</button>
        </div>
      </>
    );
  }

  if (snap.state === 'error')
    return (
      <>
        {title}
        <p className="small err-text">No se pudieron descargar las calles: {snap.message}. Revisa tu conexión e inténtalo de nuevo.</p>
        <div className="row">
          <span className="spacer" />
          <button onClick={on.snapCancel}>Cancelar</button>
        </div>
      </>
    );

  const { result } = snap;
  const before = lengthKm(coordsOf(route));
  const pct = Math.round(result.matched * 100);
  return (
    <>
      {title}
      {margin}
      <p className="small">
        <b>{pct}%</b> del trazo queda sobre calles · se movió <b>{Math.round(result.meanShift)} m</b> en promedio (máx. {Math.round(result.maxShift)} m) ·{' '}
        {before.toFixed(2)} → {lengthKm(result.coords).toFixed(2)} km · {result.coords.length} puntos
      </p>
      {result.unmatched.length > 0 && (
        <p className="small warn-text">
          {result.unmatched.length} tramo(s) sin calle a ≤ {snap.maxDist} m se quedan como estaban (rosa punteado). Si sí van por una calle, sube la distancia.
        </p>
      )}
      <p className="small muted">En el mapa, el trazo ajustado se ve en blanco.</p>
      <div className="row">
        <span className="spacer" />
        <button onClick={on.snapCancel}>Cancelar</button>
        <button className="primary" onClick={on.snapApply} disabled={result.matched === 0}>
          Aplicar
        </button>
      </div>
    </>
  );
}
