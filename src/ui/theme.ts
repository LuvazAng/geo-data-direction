import { useCallback, useState } from 'react';

export type Theme = 'oscuro' | 'claro';

const KEY = 'tema';

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'claro' ? 'claro' : 'oscuro';
  } catch {
    return 'oscuro';
  }
}

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};

/** Aplica el tema guardado (oscuro si no hay ninguno). Se llama antes de pintar para que no haya destello. */
export function initTheme() {
  apply(stored());
}

/** El tema de la app y cómo cambiarlo; la elección se recuerda en el navegador. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  const change = useCallback((next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // sin almacenamiento: el cambio vale mientras la página siga abierta
    }
  }, []);
  return [theme, change];
}
