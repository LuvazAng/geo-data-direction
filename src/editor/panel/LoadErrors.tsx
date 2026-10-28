import type { LoadError } from '../hooks/useFileSession';

/** Archivos que no se pudieron leer, con el motivo. */
export function LoadErrors({ errors }: { errors: LoadError[] }) {
  if (errors.length === 0) return null;
  return (
    <section>
      <h2>No se pudieron leer</h2>
      {errors.map((e) => (
        <div key={e.path} className="card error">
          <strong>{e.path}</strong>
          <div>{e.message}</div>
        </div>
      ))}
    </section>
  );
}
