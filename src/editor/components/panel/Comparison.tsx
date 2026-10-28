import type { Route } from '../../services/route';
import type { Pair } from '../../state/derived';
import { PairCard } from '../PairCard';

/** Comparación de las principales de dos en dos. */
export function PairsSection({ pairs, tolerance, onInvert }: { pairs: Pair[]; tolerance: number; onInvert: (id: string) => void }) {
  if (pairs.length === 0) return null;
  return (
    <section>
      <h2>Comparación</h2>
      {pairs.map((p) => (
        <PairCard key={`${p.a.id}-${p.b.id}`} {...p} onInvert={onInvert} tolerance={tolerance} />
      ))}
    </section>
  );
}

/** Trazos que parecen ir al revés, con el motivo y un botón para invertirlos. */
export function InvertSuggestions({ suggestions, onInvert }: { suggestions: { route: Route; reasons: string[] }[]; onInvert: (id: string) => void }) {
  return (
    <>
      {suggestions.map(({ route, reasons }) => (
        <div key={route.id} className="suggestion">
          <span>
            <b>{route.letter}</b> parece ir al revés según {reasons.join(' y ')}.
          </span>
          <button onClick={() => onInvert(route.id)}>Invertir {route.letter}</button>
        </div>
      ))}
    </>
  );
}
