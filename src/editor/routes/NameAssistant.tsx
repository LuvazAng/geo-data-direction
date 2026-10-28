import type { CSSProperties } from 'react';
import { Fold, Icon } from '@ui';
import { validSiglas } from '@core';
import type { SiglasResponse } from '@protocol';
import type { NameCandidate } from '../state/naming';
import type { NameActions, NamePlace, NameView } from './types';

interface Props {
  view: NameView;
  on: NameActions;
}

const SOURCE_TEXT: Record<NamePlace['fuente'], string> = {
  config: 'de la configuración del lote',
  aprendido: 'del catálogo del lote',
  sugerido: 'sugeridas en el reporte',
  qwen: 'propuestas por Qwen',
  regla: 'por la regla de siglas',
  manual: 'escritas a mano',
};

const ROUTE_SOURCE: Partial<Record<string, string>> = { config: 'de la configuración del lote', aprendido: 'del catálogo del lote' };

/** Qué pasó con Qwen en esta petición, en una línea. */
function iaLine(ia: SiglasResponse['ia']): { text: string; warn: boolean } {
  if (!ia.habilitada) return { text: 'La IA está desactivada: las siglas que no estaban en el catálogo salen de la regla de siglas.', warn: true };
  if (ia.error) return { text: `Qwen no respondió (${ia.error}): las siglas nuevas salen de la regla de siglas.`, warn: true };
  if (!ia.usada) return { text: 'Todas las siglas ya estaban en el catálogo del lote; no hizo falta preguntarle a Qwen.', warn: false };
  const seconds = ia.ms === undefined ? '' : ` en ${(ia.ms / 1000).toFixed(1)} s`;
  return { text: `Qwen${ia.modelo ? ` (${ia.modelo})` : ''} propuso las siglas nuevas${seconds}; se comprobó que cumplan la regla.`, warn: false };
}

function Candidate({ candidate, current, onUse }: { candidate: NameCandidate; current: boolean; onUse: () => void }) {
  const { evaluacion } = candidate;
  const failing = evaluacion.criterios.filter((c) => !c.ok).map((c) => c.titulo);
  return (
    <li className={`name-cand ${candidate.clave}`}>
      <div className="name-cand-head">
        <span className="name-cand-title">{candidate.titulo}</span>
        <span className={`name-score ${evaluacion.ideal ? 'full' : ''}`} title="Criterios de nombre ideal que cumple">
          {evaluacion.cumple} de {evaluacion.total}
        </span>
      </div>
      <code className="name-cand-name">{candidate.nombre}</code>
      {failing.length > 0 && <p className="small muted">Lo que falla: {failing.join('; ')}.</p>}
      <div className="row">
        {current ? (
          <span className="tag">En uso</span>
        ) : (
          <button className={`compact ${candidate.clave === 'propuesta' ? 'primary' : ''}`} onClick={onUse}>
            Usar este nombre
          </button>
        )}
      </div>
      <Fold title="Criterios">
        <ul className="criteria">
          {evaluacion.criterios.map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : 'bad'}>
              <Icon name={c.ok ? 'check' : 'x'} size={13} />
              <span>
                <b>{c.titulo}.</b> {c.detalle}
              </span>
            </li>
          ))}
        </ul>
      </Fold>
    </li>
  );
}

function PlaceRow({ place, showNote, on }: { place: NamePlace; showNote: boolean; on: NameActions }) {
  const invalid = !validSiglas(place.siglas);
  return (
    <li className="name-place">
      <div className="name-place-label">
        <b>{place.nombre}</b>
        {place.detalle && <span className="small muted"> {place.detalle}</span>}
      </div>
      <input
        value={place.siglas}
        onChange={(e) => on.setSiglas(place.nombre, e.target.value)}
        aria-label={`Siglas de ${place.nombre}`}
        aria-invalid={invalid}
        spellCheck={false}
        maxLength={6}
        size={7}
      />
      <span className={`small ${invalid ? 'warn-text' : 'muted'}`}>{invalid ? 'De 2 a 6 letras o cifras.' : SOURCE_TEXT[place.fuente]}</span>
      {showNote && place.nota && <span className="small warn-text name-place-note">{place.nota}</span>}
    </li>
  );
}

/** Sugerencia de nombre RUTA-ORIGEN-DESTINO del trazo seleccionado (y su dupla) y comparación con el nombre original. */
export function NameAssistant({ view, on }: Props) {
  const { answer } = view;
  const proposals = view.trazos.filter((t) => t.report?.propuesta).length;
  const ia = answer.state === 'ok' ? iaLine(answer.response.ia) : null;

  return (
    <section className="insp-block name-assistant" aria-label="Sugerir nombre">
      <div className="row name-head">
        <h3>
          <Icon name="sparkles" size={14} /> Sugerir nombre
        </h3>
        <span className="spacer" />
        <button className="icon" onClick={on.close} aria-label="Cerrar el asistente de nombres" title="Cerrar">
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className="small muted">
        Forma el nombre con la ruta, la colonia donde empieza el trazo y la colonia donde termina: <code>RUTA-ORIGEN-DESTINO</code>. La ida y el regreso se
        nombran juntos.
      </p>

      {answer.state === 'loading' && (
        <p className="muted loading-line">
          <span className="spinner" aria-hidden="true" /> Buscando las siglas de las colonias…
        </p>
      )}

      {answer.state === 'error' && (
        <div className="hint warn" role="alert">
          <Icon name="alert" size={14} />
          <div>
            {answer.message}
            <div className="row">
              <button className="compact" onClick={on.retry}>
                <Icon name="refresh" size={13} /> Volver a intentar
              </button>
            </div>
          </div>
        </div>
      )}

      {answer.state === 'ok' && ia && (
        <>
          <div className={`hint ${ia.warn ? 'warn' : 'ok'}`}>
            <Icon name={ia.warn ? 'info' : 'check'} size={14} />
            <div>{ia.text}</div>
          </div>
          {answer.response.ia.descartes.length > 0 && (
            <Fold title="Propuestas de Qwen descartadas" count={answer.response.ia.descartes.length}>
              <ul className="small muted name-discards">
                {answer.response.ia.descartes.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </Fold>
          )}

          <label className="field">
            <span className="muted small">Ruta</span>
            <input value={view.ruta} onChange={(e) => on.setRuta(e.target.value)} spellCheck={false} aria-label="Código de la ruta" size={8} />
            <span className="small muted">{ROUTE_SOURCE[answer.response.ruta.fuente] ?? 'del reporte del lote'}</span>
          </label>

          <h4 className="name-sub">Siglas de las colonias</h4>
          <ul className="name-places">
            {view.lugares.map((p) => (
              <PlaceRow key={p.nombre} place={p} showNote={answer.response.ia.habilitada && !answer.response.ia.error} on={on} />
            ))}
          </ul>

          {view.trazos.map(({ subject, report }) => (
            <div key={subject.id} className="name-trace" style={{ '--route-color': subject.color } as CSSProperties}>
              <div className="name-trace-head">
                <span className="badge">{subject.letter}</span>
                <span className="small">
                  <b>{subject.inicio?.nombre ?? 'Sin colonia'}</b> → <b>{subject.final?.nombre ?? 'Sin colonia'}</b>
                </span>
              </div>
              {!report ? (
                <p className="small warn-text">
                  {!subject.inicio && !subject.final
                    ? 'Ni el inicio ni el final caen en una colonia.'
                    : `${subject.inicio ? 'El final' : 'El inicio'} no cae en ninguna colonia: ponle el nombre a mano.`}
                </p>
              ) : (
                <>
                  {!report.propuesta && <p className="small warn-text">Escribe unas siglas válidas para las dos colonias y aparecerá la propuesta.</p>}
                  {report.comparacion && (
                    <p className={`small ${report.comparacion.mejor === 'propuesta' ? 'ok-text' : 'warn-text'}`}>{report.comparacion.texto}</p>
                  )}
                  <ul className="name-cands">
                    {report.candidatos.map((c) => (
                      <Candidate key={c.clave} candidate={c} current={c.nombre === subject.actual} onUse={() => on.use(subject.id, c.nombre)} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}

          {proposals > 1 && (
            <div className="row">
              <button className="primary" onClick={on.useAll}>
                Usar la propuesta en los {proposals} trazos
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
