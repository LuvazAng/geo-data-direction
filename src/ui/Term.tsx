import { useId, type ReactNode } from 'react';

/** Palabra con su definición, que aparece al pasar el cursor o con el teclado. */
export function Term({ definition, children }: { definition: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="term" tabIndex={0} aria-describedby={id}>
      {children}
      <span className="term-tip" role="tooltip" id={id}>
        {definition}
      </span>
    </span>
  );
}
