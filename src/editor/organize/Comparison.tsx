import { Fold } from '@ui';
import type { Route } from '../services/route';
import type { Pair } from '../state/derived';
import { PairCard } from './PairCard';

/** Comparación de las principales de dos en dos: si una es el regreso de la otra. */
export function PairsSection({ pairs, tolerance, onInvert }: { pairs: Pair[]; tolerance: number; onInvert: (id: string) => void }) {
  if (pairs.length === 0) return null;
  return (
    <Fold title="Comparación de pares" count={pairs.length} defaultOpen>
      {pairs.map((p) => (
        <PairCard key={`${p.a.id}-${p.b.id}`} {...p} onInvert={onInvert} tolerance={tolerance} />
      ))}
    </Fold>
  );
}

/** Trazos que parecen ir al revés, con el motivo y un botón para invertirlos. */
export function InvertSuggestions({ suggestions, onInvert }: { suggestions: { route: Route; reasons: string[] }[]; onInvert: (id: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="attention" role="status">
      <h3>Atención · {suggestions.length}</h3>
      {suggestions.map(({ route, reasons }) => (
        <div key={route.id} className="attention-item">
          <span>
            <b>{route.letter}</b> parece ir al revés según {reasons.join(' y ')}.
          </span>
          <button onClick={() => onInvert(route.id)}>Invertir {route.letter}</button>
        </div>
      ))}
    </div>
  );
}
