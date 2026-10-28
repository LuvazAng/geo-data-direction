import { useEffect, useState } from 'react';
import { fetchColonias, type ColoniaIndex } from '@core';

/** Colonias del INE (public/datos): para el mapa, la tarjeta y el campo COLONIAS del KML. */
export function useColonias() {
  const [colonias, setColonias] = useState<{ index?: ColoniaIndex; error?: string }>({});
  const [showColonias, setShowColonias] = useState(false);
  useEffect(() => {
    fetchColonias().then(
      (index) => setColonias({ index }),
      (e: Error) => setColonias({ error: e.message }),
    );
  }, []);
  return { colonias, showColonias, setShowColonias };
}
