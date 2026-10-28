import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@ui';
import { RELATION_TEXT, isCircuit, lengthKm, type RelationKind } from '@core';
import { coordsOf, type Route } from '../services/route';
import { define } from '../tools/glossary';
import { RouteLine } from './RouteLine';
import type { RouteActions } from './types';

interface Props {
  route: Route;
  selected: boolean;
  role?: { kind: 'principal' | 'corto'; percent: number };
  dupla?: number;
  /** Para tramos cortos: con qué principal encaja mejor. */
  relation?: { mainLetter: string; kind: RelationKind; needsReverse: boolean };
  /** Para rutas alternas: de qué se formó. */
  altLabel?: string;
  on: Pick<RouteActions, 'select' | 'toggle' | 'remove'>;
  /** El inspector, que sólo se pinta para el trazo seleccionado. */
  children?: ReactNode;
}

interface Tag {
  text: string;
  kind: '' | 'warn' | 'principal' | 'short' | 'alt';
  help: string;
}

/** Etiquetas del trazo por orden de importancia: primero lo que cambió, luego su papel. */
function tagsOf({ route, role, dupla, altLabel }: Pick<Props, 'route' | 'role' | 'dupla' | 'altLabel'>): Tag[] {
  const autoAmpl = Object.entries(route.parsed.props).find(([k]) => k.toUpperCase().replace(/[^A-Z]/g, '') === 'AUTOAMPL')?.[1];
  const tags: (Tag | false | undefined | '')[] = [
    route.reversed && { text: 'invertido', kind: 'warn', help: 'Se guardará en el sentido contrario al que traía el archivo.' },
    route.edited && { text: 'editado', kind: 'warn', help: 'La geometría ya no es la del archivo.' },
    route.alt && { text: 'ruta alterna', kind: 'alt', help: altLabel ? `${altLabel}. ${define('ruta-alterna')}` : define('ruta-alterna') },
    !route.alt && role?.kind === 'principal' && { text: 'principal', kind: 'principal', help: define('principal') },
    !route.alt && role?.kind === 'corto' && { text: `tramo corto · ${Math.round(role.percent * 100)}%`, kind: 'short', help: define('tramo-corto') },
    dupla !== undefined && { text: `dupla ${dupla}`, kind: '', help: define('dupla') },
    isCircuit(coordsOf(route)) && { text: 'circuito', kind: '', help: define('circuito') },
    autoAmpl && { text: autoAmpl.toLowerCase(), kind: '', help: 'Dato AUTO-AMPL que traía el archivo.' },
  ];
  return tags.filter((t): t is Tag => !!t);
}

const MAX_TAGS = 2;

/** Un trazo en la lista: letra, nombre, su recorrido en miniatura y a lo más dos etiquetas. */
export function RouteRow({ route, selected, role, dupla, relation, altLabel, on, children }: Props) {
  const coords = coordsOf(route);
  const multi = route.parsed.count > 1;
  const title = multi || route.source.isNew ? route.outName : route.source.file.name;
  const tags = tagsOf({ route, role, dupla, altLabel });
  const shown = tags.slice(0, MAX_TAGS);
  const hidden = tags.slice(MAX_TAGS);

  return (
    <div className={`route-row ${selected ? 'selected' : ''}`} style={{ '--route-color': route.color } as CSSProperties}>
      <div className="row-head">
        <div
          className="row-main"
          role="button"
          tabIndex={0}
          aria-expanded={selected}
          onClick={on.select}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              on.select();
            }
          }}
        >
          <span className="badge">{route.letter}</span>
          <span className="row-text">
            <strong className="row-title" title={route.source.path}>
              {title}
            </strong>
            <span className="row-meta">
              <RouteLine />
              <span className="muted small">
                {lengthKm(coords).toFixed(2)} km · {coords.length} puntos
              </span>
            </span>
            {tags.length > 0 && (
              <span className="tags">
                {shown.map((t) => (
                  <span key={t.text} className={`tag ${t.kind}`} title={t.help}>
                    {t.text}
                  </span>
                ))}
                {hidden.length > 0 && (
                  <span className="tag" title={hidden.map((t) => `${t.text}: ${t.help}`).join('\n')}>
                    +{hidden.length}
                  </span>
                )}
              </span>
            )}
            {relation && (
              <span className={`small ${relation.kind === 'ninguna' ? 'muted' : ''}`}>
                {RELATION_TEXT[relation.kind]}
                {relation.kind !== 'ninguna' && (
                  <>
                    {' '}
                    de <b>{relation.mainLetter}</b>
                    {relation.needsReverse && ' (dibujado al revés)'}
                  </>
                )}
              </span>
            )}
            {altLabel && <span className="small muted">{altLabel}</span>}
            {route.saved && (
              <span className="small saved">
                <Icon name="check" size={13} /> {route.saved}
              </span>
            )}
          </span>
        </div>
        <button
          className="icon"
          title={route.visible ? 'Ocultar en el mapa' : 'Mostrar en el mapa'}
          aria-label={route.visible ? `Ocultar ${route.letter} en el mapa` : `Mostrar ${route.letter} en el mapa`}
          onClick={on.toggle}
        >
          <Icon name={route.visible ? 'eye' : 'eye-off'} />
        </button>
        <button
          className="icon"
          title="Quitar de la lista (Supr). No borra el archivo del disco."
          aria-label={`Quitar ${route.letter} de la lista`}
          onClick={on.remove}
        >
          <Icon name="x" />
        </button>
      </div>
      {selected && children}
    </div>
  );
}
