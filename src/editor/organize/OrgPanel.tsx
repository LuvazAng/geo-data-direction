import { Fold, Icon, Term } from '@ui';
import { type Route, coordsOf } from '../services/route';
import { lengthKm, canBuildAlternative, PRINCIPAL_RATIO, RELATION_TEXT, type Organization, type Relation } from '@core';
import { define } from '../tools/glossary';

interface Props {
  org: Organization;
  routes: Route[];
  /** Claves `${mainId}:${shortId}` de alternas ya creadas. */
  createdAlts: Set<string>;
  /** Principal elegida para cada tramo corto (si no, la recomendada). */
  choice: Record<string, string>;
  /** Relación tramo ↔ principal con los vértices ajustados a mano. */
  relationFor: (shortId: string, mainId: string) => Relation | undefined;
  onChoose: (shortId: string, mainId: string) => void;
  onVertex: (shortId: string, mainId: string, which: 'out' | 'in', vertex: number) => void;
  onCreateAlt: (shortId: string, mainId: string) => void;
  onAssignFolders: () => void;
  onSelect: (id: string) => void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Duplas (ida y regreso) y los tramos cortos que se les unen. Cada tramo es una fila; sus ajustes finos van plegados. */
export function OrgPanel({ org, routes, createdAlts, choice, relationFor, onChoose, onVertex, onCreateAlt, onAssignFolders, onSelect }: Props) {
  const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
  const Badge = ({ id }: { id: string }) => {
    const r = byId[id];
    if (!r) return null;
    return (
      <button
        className="badge as-button"
        style={{ '--route-color': r.color } as React.CSSProperties}
        title={`${r.outName} · ver en el mapa`}
        aria-label={`Ver ${r.letter} en el mapa`}
        onClick={() => onSelect(id)}
      >
        {r.letter}
      </button>
    );
  };
  const shorts = Object.keys(org.relations);
  const principals = Object.entries(org.role).filter(([, v]) => v.kind === 'principal').length;
  const altsOf = (mainIds: string[]) => routes.filter((r) => r.alt && mainIds.includes(r.alt.mainId));

  const shortItem = (id: string) => {
    const options = org.relations[id].filter(canBuildAlternative);
    const best = org.relations[id][0];
    const mainId = choice[id] && options.some((o) => o.mainId === choice[id]) ? choice[id] : options[0]?.mainId;
    const rel = mainId ? relationFor(id, mainId) : undefined;
    const main = mainId ? byId[mainId] : undefined;
    const key = `${mainId}:${id}`;
    const vertexInput = (which: 'out' | 'in', value?: number) =>
      value !== undefined && (
        <input
          type="number"
          className="vertex-input"
          min={1}
          max={rel?.mainVertices}
          value={value}
          aria-label={which === 'out' ? 'Vértice donde sale' : 'Vértice donde se reincorpora'}
          onChange={(e) => mainId && onVertex(id, mainId, which, Number(e.target.value))}
        />
      );

    return (
      <li key={id}>
        <div className="row">
          <Badge id={id} />
          <span className="short-name">{byId[id]?.outName}</span>
          <span className="spacer" />
          <span className="small muted">{byId[id] && `${lengthKm(coordsOf(byId[id])).toFixed(2)} km`}</span>
        </div>
        {!rel || !main ? (
          <div className="small muted">
            {RELATION_TEXT[best.kind]}
            {best.kind === 'sobre' && (
              <>
                {' '}
                de <Badge id={best.mainId} /> (no aporta un recorrido distinto)
              </>
            )}
          </div>
        ) : (
          <>
            <div className="small muted">{RELATION_TEXT[rel.kind]}</div>
            <div className="row">
              <button className="primary compact" disabled={createdAlts.has(key)} onClick={() => onCreateAlt(id, main.id)}>
                {createdAlts.has(key) ? (
                  <>
                    <Icon name="check" size={14} /> Alterna creada
                  </>
                ) : (
                  `Crear ruta alterna ${main.letter} + ${byId[id]?.letter}`
                )}
              </button>
              <button className="quiet compact" onClick={() => onSelect(id)}>
                Ver en el mapa
              </button>
            </div>
            <Fold title="Ajustar unión">
              <p className="small muted">Elige con qué principal se une el tramo y en qué vértices sale de ella y se reincorpora.</p>
              <div className="row small">
                <span className="muted">Unir con</span>
                <select value={mainId} onChange={(e) => onChoose(id, e.target.value)}>
                  {options.map((o) => (
                    <option key={o.mainId} value={o.mainId}>
                      {byId[o.mainId]?.letter} — {RELATION_TEXT[o.kind].split(':')[0]}
                      {o.needsReverse ? ', invirtiendo el tramo' : ''}
                      {o === options[0] ? ' (recomendado)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row small vertices">
                {rel.outVertex !== undefined && (
                  <span>
                    sale en el <Term definition={define('vertice')}>vértice</Term> {vertexInput('out', rel.outVertex)} de <b>{main.letter}</b>
                  </span>
                )}
                {rel.inVertex !== undefined && rel.kind !== 'lazo' && (
                  <span>
                    se {rel.outVertex !== undefined ? 'reincorpora' : 'incorpora'} en el {vertexInput('in', rel.inVertex)}
                  </span>
                )}
                <span className="muted">(de {rel.mainVertices})</span>
              </div>
            </Fold>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="org">
      <p className="small muted">
        {principals} <Term definition={define('principal')}>principal(es)</Term> y {shorts.length}{' '}
        <Term definition={define('tramo-corto')}>tramo(s) corto(s)</Term>. Es principal el trazo que mide al menos {pct(PRINCIPAL_RATIO)} del más largo.
      </p>

      {org.duplas.map((d) => {
        const mine = shorts.filter((s) => org.folderOf[s] === String(d.n));
        const alts = altsOf(d.ids);
        return (
          <div key={d.n} className="card dupla">
            <div className="row">
              <b>
                <Term definition={define('dupla')}>Dupla {d.n}</Term>
              </b>
              {d.ids.map((id, i) => (
                <span key={id}>
                  {i > 0 && ' ⇄ '}
                  <Badge id={id} />
                </span>
              ))}
            </div>
            {d.pair ? (
              <div className={`small ${d.pair.direction === 'opuesto' ? 'ok-text' : 'warn-text'}`}>
                {pct(d.pair.similarity)} de coincidencia ·{' '}
                {d.pair.direction === 'opuesto'
                  ? 'ida y regreso ✓'
                  : d.pair.direction === 'mismo'
                    ? '⚠ van en el mismo sentido: invierte uno'
                    : 'sentido indefinido (¿circuito?)'}
              </div>
            ) : (
              <div className="small muted">Sin pareja: ningún otro principal coincide ≥ 40%.</div>
            )}
            {mine.length > 0 && <ul className="shorts">{mine.map(shortItem)}</ul>}
            {alts.length > 0 && (
              <div className="small">
                Alternas creadas:{' '}
                {alts.map((r) => (
                  <Badge key={r.id} id={r.id} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {shorts.some((s) => org.folderOf[s] === 'sin-relacion') && (
        <div className="card dupla">
          <b>Sin relación con ninguna ruta</b>
          <ul className="shorts">{shorts.filter((s) => org.folderOf[s] === 'sin-relacion').map(shortItem)}</ul>
        </div>
      )}

      <div className="row">
        <button onClick={onAssignFolders}>
          <Icon name="split" /> Separar en carpetas por dupla
        </button>
        <span className="small muted">Cada dupla con sus ampliaciones y alternas va a su carpeta (1, 2…).</span>
      </div>
    </div>
  );
}
