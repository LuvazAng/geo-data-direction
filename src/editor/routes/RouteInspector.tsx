import type { ReactNode } from 'react';
import { Fold, Icon, Term } from '@ui';
import { markerStatus, type DescribedEnds, type DescriptionHint } from '@core';
import { endAddr, startAddr, type Route } from '../services/route';
import { safeFileName, supportsSaveAs } from '../services/files';
import { define } from '../tools/glossary';
import { Addr, ColoniasList, Oneways, coloniasCount } from './parts';
import { ShapeTool } from './ShapeTool';
import type { ColoniasView, RouteActions, ShapeToolId, SnapView } from './types';

interface Props {
  route: Route;
  /** Carpetas disponibles en la app. */
  folders: string[];
  /** Herramienta de forma abierta en este trazo, si hay una. */
  tool: ShapeToolId | null;
  manualReview: boolean;
  hint?: { ends: DescribedEnds | null; hint: DescriptionHint };
  snap?: SnapView;
  colonias?: ColoniasView;
  /** El asistente de nombres, si está abierto en este trazo. */
  assistant?: ReactNode;
  on: RouteActions;
}

const MARKER_TEXT = {
  none: 'El archivo no tenía INICIO/FINAL.',
  ok: 'El INICIO/FINAL del archivo coincide con el trazo.',
  reversed: 'El INICIO/FINAL del archivo estaba al revés del trazo; se orientó según ellos.',
  circuit: 'Es un circuito: inicio y fin a menos de 500 m.',
} as const;

/** Lo esencial del trazo seleccionado: su sentido, dónde se guarda y las colonias; lo demás se abre desde Herramientas. */
export function RouteInspector({ route, folders, tool, manualReview, hint, snap, colonias, assistant, on }: Props) {
  const status = markerStatus(route.parsed.coords, route.parsed.markers);
  const desc = Object.entries(route.parsed.props).find(([k]) => k.toUpperCase().startsWith('DESCRIP'))?.[1];
  const multi = route.parsed.count > 1;
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
  const saveNote = manualReview
    ? 'Ajusta el recorrido en el mapa; el resultado se registra al pulsar «Guardar y generar».'
    : saveHow === 'disk'
      ? `Se guardará como «${target}»${
          !multi && !route.source.isNew && route.source.file.name.toLowerCase().endsWith('.kml') && route.folder
            ? ' (el .kml original se mueve ahí)'
            : multi
              ? ' (el archivo original con todos los trazos se conserva)'
              : ''
        }.`
      : saveHow === 'ask'
        ? `Al guardar eliges la carpeta y el nombre (sugerido «${route.outName}.kml»).`
        : `Se descargará como «${route.outName}.kml».`;

  return (
    <div className="inspector">
      {origin && <p className="small muted origin">{origin}</p>}
      <div className="row">
        <button onClick={on.invert} title="Atajo: R">
          <Icon name="swap" /> Invertir sentido
        </button>
        <button onClick={on.zoom}>
          <Icon name="locate" /> Ver en el mapa
        </button>
      </div>

      <section className="insp-block">
        {desc && (
          <p className="small">
            <span className="muted">Descripción:</span> {desc}
          </p>
        )}
        <div className="ends">
          <div className="end-item start">
            <span className="dot start" />
            <Term definition={define('inicio-final')}>
              <b>INICIO</b>
            </Term>{' '}
            <Addr a={startAddr(route)} />
          </div>
          <div className="end-item end">
            <span className="dot end" />
            <Term definition={define('inicio-final')}>
              <b>FINAL</b>
            </Term>{' '}
            <Addr a={endAddr(route)} />
          </div>
        </div>
        {hint?.ends && hint.hint === 'coincide' && (
          <div className="hint ok">
            <Icon name="check" size={14} />
            <div>
              Coincide con la descripción: {hint.ends.origin} → {hint.ends.destination}
            </div>
          </div>
        )}
        {hint?.ends && hint.hint === 'invertido' && (
          <div className="hint warn">
            <Icon name="alert" size={14} />
            <div>
              La descripción dice {hint.ends.origin} → {hint.ends.destination}, pero el trazo va al revés.
            </div>
          </div>
        )}
        <Oneways route={route} onRetry={on.retryOneways} />
        {!route.alt && (
          <p className={`small ${status.kind === 'far' ? 'warn-text' : 'muted'}`}>
            {status.kind === 'far' ? `Los marcadores del archivo estaban a ${status.meters} m de los extremos.` : MARKER_TEXT[status.kind]}
          </p>
        )}
      </section>

      {tool ? (
        <ShapeTool tool={tool} route={route} snap={snap} on={on} />
      ) : (
        <section className="insp-block">
          <h3>Guardar</h3>
          <label className="field">
            <span className="muted small">Carpeta</span>
            <select className="folder-select" value={route.folder} onChange={(e) => on.setFolder(e.target.value)}>
              <option value="">(sin carpeta)</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted small">Nombre</span>
            <input value={route.outName} onChange={(e) => on.rename(e.target.value)} spellCheck={false} />
            <span className="muted small">.kml</span>
          </label>
          {on.suggestName && !assistant && (
            <div className="row">
              <button className="compact" onClick={on.suggestName} title="Arma RUTA-ORIGEN-DESTINO con las colonias de inicio y final">
                <Icon name="sparkles" size={14} /> Sugerir nombre
              </button>
            </div>
          )}
          <p className="small muted">{saveNote}</p>
          {!manualReview && (
            <div className="row">
              <button className="primary" onClick={on.save} title={saveHow === 'ask' ? 'Elige en qué carpeta guardarlo' : undefined}>
                <Icon name="save" /> {saveHow === 'ask' ? 'Guardar como…' : 'Guardar'}
              </button>
            </div>
          )}
        </section>
      )}

      {assistant}

      <Fold key={route.id} title="Colonias por las que pasa" count={coloniasCount(colonias)}>
        <ColoniasList view={colonias} />
      </Fold>
    </div>
  );
}
