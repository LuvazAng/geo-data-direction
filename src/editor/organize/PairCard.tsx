import type { Route } from '../services/route';
import type { PairResult } from '@core';

interface Props {
  a: Route;
  b: Route;
  result: PairResult;
  tolerance: number;
  onInvert: (id: string) => void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const m = (n: number) => (n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`);

export function PairCard({ a, b, result, tolerance, onInvert }: Props) {
  const { similarity, direction, ends } = result;
  const L = (r: Route) => (
    <span className="badge" style={{ '--route-color': r.color } as React.CSSProperties}>
      {r.letter}
    </span>
  );

  let verdict: React.ReactNode;
  let tone: 'ok' | 'warn' | 'neutral' = 'neutral';
  if (similarity < 0.2) {
    verdict = 'Son trazos distintos (casi no se enciman).';
  } else if (direction === 'opuesto') {
    tone = 'ok';
    verdict = (
      <>
        {L(b)} es el regreso de {L(a)}: sentidos opuestos ✓
      </>
    );
  } else if (direction === 'mismo') {
    tone = 'warn';
    verdict = (
      <>
        {L(a)} y {L(b)} van en el <b>mismo sentido</b>. Si son ida y vuelta, invierte uno:
        <span className="row inline">
          <button onClick={() => onInvert(a.id)}>Invertir {a.letter}</button>
          <button onClick={() => onInvert(b.id)}>Invertir {b.letter}</button>
        </span>
      </>
    );
  } else {
    verdict = 'Se enciman, pero no se puede determinar el sentido (¿circuito?).';
  }

  return (
    <div className={`card pair ${tone}`}>
      <div className="pair-head">
        {L(a)} ↔ {L(b)}
        <span
          className="similarity"
          title={`${pct(result.coverageAB)} de ${a.letter} cae sobre ${b.letter}; ${pct(result.coverageBA)} de ${b.letter} cae sobre ${a.letter}`}
        >
          {pct(similarity)} de coincidencia
        </span>
      </div>
      <div className="meter">
        <div style={{ width: pct(similarity) }} />
      </div>
      <div className="verdict">{verdict}</div>
      <div className="small muted">
        a ≤ {tolerance} m · INICIO {a.letter}↔FINAL {b.letter}: {m(ends.startEnd)} · FINAL {a.letter}↔INICIO {b.letter}: {m(ends.endStart)} · INICIO↔INICIO:{' '}
        {m(ends.startStart)}
      </div>
    </div>
  );
}
