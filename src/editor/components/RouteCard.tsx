import { useEffect, useMemo, useState } from 'react';
import { baseCoords, coordsOf, endAddr, onewayOf, startAddr, type AddrState, type Route } from '../services/route';
import { onewayVerdict, streetsSummary } from '../services/oneway';
import {
  isCircuit,
  lengthKm,
  markerStatus,
  type DescribedEnds,
  type DescriptionHint,
  simplify,
  RELATION_TEXT,
  type RelationKind,
  type ColoniasRuta,
} from '@core';
import { formatAddress } from '../services/geocode';
import { MAX_SNAP_M, type SnapResult } from '../services/snap';
import { safeFileName, supportsSaveAs } from '../services/files';

/** Colonias por las que pasa el trazo (sólo del seleccionado). */
export type ColoniasView = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; result: ColoniasRuta };

/** Ajuste a calles en vista previa para este trazo. */
export type SnapView = { maxDist: number } &
  /** `progress` no llega mientras espera a que termine otra descarga. */
  ({ state: 'loading'; since: number; progress?: { done: number; total: number } } | { state: 'error'; message: string } | { state: 'ok'; result: SnapResult });

export interface RouteActions {
  select: () => void;
  invert: () => void;
  toggle: () => void;
  setOpacity: (opacity: number) => void;
  zoom: () => void;
  rename: (name: string) => void;
  setFolder: (folder: string) => void;
  save: () => void;
  retryOneways: () => void;
  simplify: (toleranceM: number) => void;
  snapStart: () => void;
  snapDistance: (m: number) => void;
  snapApply: () => void;
  snapCancel: () => void;
  toggleEdit: () => void;
  undo: () => void;
  restore: () => void;
  /** Quita el trazo de la lista (no borra el archivo del disco). */
  remove: () => void;
}

interface Props {
  route: Route;
  selected: boolean;
  editing: boolean;
  /** Carpetas disponibles en la app. */
  folders: string[];
  role?: { kind: 'principal' | 'corto'; percent: number };
  manualReview?: boolean;
  dupla?: number;
  /** Para tramos cortos: con qué principal encaja mejor. */
  relation?: { mainLetter: string; kind: RelationKind; needsReverse: boolean };
  /** Para rutas alternas: de qué se formó. */
  altLabel?: string;
  hint?: { ends: DescribedEnds | null; hint: DescriptionHint };
  snap?: SnapView;
  colonias?: ColoniasView;
  on: RouteActions;
}

function Addr({ a }: { a?: AddrState }) {
  if (!a || a.state === 'loading') return <span className="muted">buscando dirección…</span>;
  if (a.state === 'error') return <span className="muted">sin dirección ({a.message})</span>;
  return <span>{formatAddress(a.address) || a.address.full.split(' | ')[0]}</span>;
}

const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const streetList = (list: [string, number][]) =>
  list
    .slice(0, 3)
    .map(([name, m]) => `${name} (${km(m)})`)
    .join(', ');

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const Spinner = () => <span className="spinner" aria-hidden="true" />;

/** Tiempo transcurrido (m:ss), se actualiza cada segundo. */
function Elapsed({ since }: { since: number }) {
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

function Oneways({ route, onRetry }: { route: Route; onRetry: () => void }) {
  const state = route.oneway;
  if (state?.state === 'error')
    return (
      <div className="small muted" onClick={stop}>
        Calles de un sentido: no se pudo consultar ({state.message}){' '}
        <button className="link" onClick={onRetry}>
          reintentar
        </button>
      </div>
    );
  const r = onewayOf(route);
  if (!r)
    return (
      <div className="small muted loading-line">
        <Spinner /> Consultando calles de un sentido (OSM)…
      </div>
    );
  const verdict = onewayVerdict(r);
  const favor = `${km(r.agreeM)} a favor · ${km(r.againstM)} en contra`;
  if (verdict === 'sin-datos') return <div className="small muted">Calles de un sentido: el trazo casi no pasa por ninguna (sin datos en OSM).</div>;
  if (verdict === 'correcto')
    return (
      <div className="hint ok" title={streetList(streetsSummary(r, true))}>
        ✓ Respeta las calles de un sentido: {favor}
      </div>
    );
  return (
    <div className={`hint ${verdict === 'invertido' ? 'warn' : 'mixed'}`}>
      {verdict === 'invertido' ? '⚠ Va en contra de las calles de un sentido' : '≈ Sentido mixto en calles de un sentido'}: {favor}
      <div className="small">En contra: {streetList(streetsSummary(r, false))}</div>
    </div>
  );
}

function Colonias({ view }: { view?: ColoniasView }) {
  if (!view) return null;
  if (view.state === 'loading')
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
    <details className="colonias" open onClick={stop}>
      <summary className="small">
        Pasa por {pasos.length} colonia{pasos.length === 1 ? '' : 's'}
        {fuera}
      </summary>
      <ol>
        {pasos.map((p) => (
          <li key={p.ids.join('-')} title={p.colonia.cp && `C.P. ${p.colonia.cp}`}>
            {p.colonia.nombre} <span className="muted">{[p.colonia.tipo, p.colonia.municipio, km(p.metros)].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ol>
      <div className="small muted">Fuente: INE. Se guardan en el KML (campo COLONIAS).</div>
    </details>
  );
}

const MARKER_TEXT = {
  none: 'El archivo no tenía INICIO/FINAL',
  ok: 'INICIO/FINAL del archivo coinciden con el trazo',
  reversed: 'INICIO/FINAL del archivo estaban al revés del trazo → se orientó según ellos',
  circuit: 'Circuito: inicio y fin a menos de 500 m',
} as const;

function RoleTags({ role, dupla, route, altLabel }: Pick<Props, 'role' | 'dupla' | 'route' | 'altLabel'>) {
  return (
    <>
      {route.alt ? (
        <span className="tag alt" title={altLabel}>
          ruta alterna
        </span>
      ) : role?.kind === 'principal' ? (
        <span className="tag principal">principal</span>
      ) : role ? (
        <span className="tag short">tramo corto · {Math.round(role.percent * 100)}%</span>
      ) : null}
      {dupla !== undefined && <span className="tag">dupla {dupla}</span>}
      {route.reversed && <span className="tag warn">invertido</span>}
      {route.edited && <span className="tag warn">editado</span>}
    </>
  );
}

/** Ajuste a las calles de OSM con vista previa en el mapa. */
function Snap({ route, snap, on }: { route: Route; snap?: SnapView; on: RouteActions }) {
  if (!snap)
    return (
      <div className="row simplify">
        <span className="small muted">Ajustar a calles</span>
        <span className="spacer" />
        <button onClick={on.snapStart} title="Mueve el trazo sobre las calles de OpenStreetMap (con vista previa)">
          ⤓ Ajustar a calles…
        </button>
      </div>
    );

  const controls = (
    <div className="row simplify">
      <span className="small muted" title="Las partes del trazo más lejos que esto de una calle se quedan como están">
        Margen
      </span>
      <input type="range" min={5} max={MAX_SNAP_M} step={5} value={snap.maxDist} onChange={(e) => on.snapDistance(Number(e.target.value))} />
      <span className="small">
        ≤ <b>{snap.maxDist} m</b> de la calle
      </span>
    </div>
  );

  if (snap.state === 'loading') {
    const { progress } = snap;
    return (
      <div className="snap">
        {controls}
        <div className="small loading-line" role="status">
          <Spinner />
          <span>
            {!progress
              ? 'En espera de otra descarga de calles…'
              : progress.total === 0
                ? 'Preparando calles…'
                : `Descargando calles de OSM · parte ${Math.min(progress.done + 1, progress.total)} de ${progress.total}`}
          </span>
          <span className="spacer" />
          <Elapsed since={snap.since} />
        </div>
        {progress && progress.total > 0 && (
          <div className="meter">
            <div style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }} />
          </div>
        )}
        <div className="small muted">
          La primera vez en una zona puede tardar 30–120 s; después queda en caché.{' '}
          <button className="link" onClick={on.snapCancel}>
            cancelar
          </button>
        </div>
      </div>
    );
  }

  if (snap.state === 'error')
    return (
      <div className="snap">
        <div className="small muted">
          No se pudieron descargar las calles ({snap.message}){' '}
          <button className="link" onClick={on.snapStart}>
            reintentar
          </button>{' '}
          ·{' '}
          <button className="link" onClick={on.snapCancel}>
            cancelar
          </button>
        </div>
      </div>
    );

  const { result } = snap;
  const before = lengthKm(coordsOf(route));
  const pct = Math.round(result.matched * 100);
  return (
    <div className="snap">
      {controls}
      <div className="small">
        <b>{pct}%</b> del trazo sobre calles · se movió <b>{Math.round(result.meanShift)} m</b> en promedio (máx. {Math.round(result.maxShift)} m) ·{' '}
        {before.toFixed(2)} → {lengthKm(result.coords).toFixed(2)} km · {result.coords.length} pts
      </div>
      {result.unmatched.length > 0 && (
        <div className="small warn-text">
          {result.unmatched.length} tramo(s) sin calle a ≤ {snap.maxDist} m se quedan como estaban (rosa punteado). Si sí van por una calle, sube la distancia.
        </div>
      )}
      <div className="small muted">En el mapa: blanco = trazo ajustado.</div>
      <div className="row">
        <span className="spacer" />
        <button onClick={on.snapCancel}>Cancelar</button>
        <button className="primary" onClick={on.snapApply} disabled={result.matched === 0}>
          Aplicar
        </button>
      </div>
    </div>
  );
}

/** Simplificación con vista previa del número de puntos. */
function Geometry({ route, editing, snap, on }: { route: Route; editing: boolean; snap?: SnapView; on: RouteActions }) {
  const [tol, setTol] = useState(5);
  const base = baseCoords(route);
  const preview = useMemo(() => simplify(base, tol).length, [base, tol]);
  const original = route.parsed.coords.length;

  return (
    <div className="geometry" onClick={stop}>
      <div className="row">
        <span className="small">
          <b>{base.length}</b> puntos{base.length !== original && <span className="muted"> (original {original})</span>}
        </span>
        <span className="spacer" />
        <button className={editing ? 'active' : ''} onClick={on.toggleEdit} title="E">
          {editing ? '✓ Terminar edición' : '✎ Editar vértices'}
        </button>
        <button onClick={on.undo} disabled={!route.history?.length} title="Ctrl+Z">
          ↶
        </button>
        <button onClick={on.restore} disabled={!route.edited} title="Volver a la geometría del archivo">
          Restaurar
        </button>
      </div>
      <div className="row simplify">
        <span className="small muted">Simplificar</span>
        <input type="range" min={0.5} max={20} step={0.5} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
        <span className="small">
          ≤ {tol} m → <b>{preview}</b> pts
        </span>
        <button onClick={() => on.simplify(tol)} disabled={preview >= base.length}>
          Aplicar
        </button>
      </div>
      <Snap route={route} snap={snap} on={on} />
      {editing && (
        <div className="small muted">
          Arrastra un vértice (amarillo) para moverlo · arrastra un punto medio (blanco) para agregar uno · clic derecho para quitarlo. Acerca el mapa para
          verlos.
        </div>
      )}
    </div>
  );
}

export function RouteCard({ route, selected, editing, folders, role, manualReview = false, dupla, relation, altLabel, hint, snap, colonias, on }: Props) {
  const coords = coordsOf(route);
  const status = markerStatus(route.parsed.coords, route.parsed.markers);
  const circuit = isCircuit(coords);
  const desc = Object.entries(route.parsed.props).find(([k]) => k.toUpperCase().startsWith('DESCRIP'))?.[1];
  const autoAmpl = Object.entries(route.parsed.props).find(([k]) => k.toUpperCase().replace(/[^A-Z]/g, '') === 'AUTOAMPL')?.[1];
  const multi = route.parsed.count > 1;
  const title = multi || route.source.isNew ? route.outName : route.source.file.name;
  const origin = route.alt
    ? ''
    : [
        route.source.path,
        multi && `trazo ${route.parsed.index + 1} de ${route.parsed.count}`,
        route.parsed.folderPath.length > 0 && `carpeta en el KML: ${route.parsed.folderPath.join(' / ')}`,
      ]
        .filter(Boolean)
        .join(' · ');
  const target = [route.folder, `${route.outName}.kml`].filter(Boolean).join('/');
  // Sin acceso a la carpeta (archivos abiertos sueltos): se sobrescribe en su lugar, se pregunta dónde o se descarga
  const hasDir = !!(route.source.dir || route.source.baseDir);
  const overwritesLoose =
    !multi && !route.source.isNew && !!route.source.handle && !route.folder && route.source.file.name === `${safeFileName(route.outName)}.kml`;
  const saveHow = hasDir || overwritesLoose ? 'disk' : supportsSaveAs() ? 'ask' : 'download';

  const head = (
    <div className="route-head">
      <span className="badge">{route.letter}</span>
      <div className="route-title">
        <strong title={route.source.path}>{title}</strong>
        <span className="small muted">
          {lengthKm(coords).toFixed(2)} km · {coords.length} pts
          {circuit && <span className="tag">circuito</span>}
          <RoleTags role={role} dupla={dupla} route={route} altLabel={altLabel} />
          {autoAmpl && <span className="tag">{autoAmpl.toLowerCase()}</span>}
        </span>
      </div>
      <button
        className="icon"
        title={route.visible ? 'Ocultar' : 'Mostrar'}
        onClick={(e) => {
          e.stopPropagation();
          on.toggle();
        }}
      >
        {route.visible ? '◉' : '○'}
      </button>
      <button
        className="icon"
        title="Eliminar trazo (Supr) · no borra el archivo del disco"
        onClick={(e) => {
          e.stopPropagation();
          on.remove();
        }}
      >
        ✕
      </button>
    </div>
  );

  const relationLine = relation && (
    <div className={`small ${relation.kind === 'ninguna' ? 'muted' : ''}`}>
      ↳ {RELATION_TEXT[relation.kind]}
      {relation.kind !== 'ninguna' && (
        <>
          {' '}
          de <b>{relation.mainLetter}</b>
          {relation.needsReverse && ' (dibujado al revés)'}
        </>
      )}
    </div>
  );

  if (!selected) {
    return (
      <div className="card route compact" style={{ '--route-color': route.color } as React.CSSProperties} onClick={on.select}>
        {head}
        {relationLine}
        {altLabel && <div className="small muted">↳ {altLabel}</div>}
        {route.saved && <div className="small saved">✓ {route.saved}</div>}
      </div>
    );
  }

  return (
    <div className="card route selected" style={{ '--route-color': route.color } as React.CSSProperties} onClick={on.select}>
      {head}
      {origin && <div className="small muted">{origin}</div>}
      {relationLine}
      {altLabel && <div className="small muted">↳ {altLabel}</div>}
      {desc && (
        <div className="small">
          <span className="muted">Descripción:</span> {desc}
        </div>
      )}

      <div className="ends">
        <div>
          <span className="dot start" /> <b>INICIO</b> <Addr a={startAddr(route)} />
        </div>
        <div>
          <span className="dot end" /> <b>FINAL</b> <Addr a={endAddr(route)} />
        </div>
      </div>

      {hint?.ends && hint.hint === 'coincide' && (
        <div className="hint ok">
          ✓ Coincide con la descripción: {hint.ends.origin} → {hint.ends.destination}
        </div>
      )}
      {hint?.ends && hint.hint === 'invertido' && (
        <div className="hint warn">
          ⚠ La descripción dice {hint.ends.origin} → {hint.ends.destination}, pero el trazo va al revés
        </div>
      )}

      <Oneways route={route} onRetry={on.retryOneways} />

      <Colonias view={colonias} />

      {!route.alt && (
        <div className="small muted">
          {status.kind === 'far' ? `⚠ Los marcadores del archivo estaban a ${status.meters} m de los extremos` : MARKER_TEXT[status.kind]}
        </div>
      )}

      <Geometry route={route} editing={editing} snap={snap} on={on} />

      <div className="row simplify" onClick={stop}>
        <span className="small muted" title="Sólo en el mapa; no cambia el KML">
          Opacidad
        </span>
        <input type="range" min={0.1} max={1} step={0.05} value={route.opacity ?? 1} onChange={(e) => on.setOpacity(Number(e.target.value))} />
        <span className="small">{Math.round((route.opacity ?? 1) * 100)}%</span>
      </div>

      <div className="outname" onClick={stop}>
        <span className="muted small">Carpeta</span>
        <select className="folder-select" value={route.folder} onChange={(e) => on.setFolder(e.target.value)}>
          <option value="">(sin carpeta)</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="outname" onClick={stop}>
        <span className="muted small">Nombre</span>
        <input value={route.outName} onChange={(e) => on.rename(e.target.value)} spellCheck={false} />
        <span className="muted small">.kml</span>
      </div>
      <div className="small muted">
        {manualReview ? (
          'Ajusta el recorrido en el mapa; el resultado se registra al pulsar «Guardar y generar».'
        ) : saveHow === 'disk' ? (
          <>
            Se guardará como «{target}»
            {!multi && !route.source.isNew && route.source.file.name.toLowerCase().endsWith('.kml') && route.folder
              ? ' (el .kml original se mueve ahí)'
              : multi
                ? ' (el archivo original con todos los trazos se conserva)'
                : ''}
          </>
        ) : saveHow === 'ask' ? (
          `Al guardar eliges la carpeta y el nombre (sugerido «${route.outName}.kml»)`
        ) : (
          `Se descargará como «${route.outName}.kml»`
        )}
      </div>

      <div className="row" onClick={stop}>
        <button onClick={on.invert} title="R">
          ⇄ Invertir sentido
        </button>
        <button onClick={on.zoom}>⌖ Ver</button>
        <span className="spacer" />
        {!manualReview && (
          <button className="primary" onClick={on.save} title={saveHow === 'ask' ? 'Elige en qué carpeta guardarlo' : undefined}>
            {saveHow === 'ask' ? 'Guardar como…' : 'Guardar'}
          </button>
        )}
      </div>
      {route.saved && <div className="small saved">✓ {route.saved}</div>}
    </div>
  );
}
