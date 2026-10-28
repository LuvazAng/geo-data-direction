import type { PendingTrace, ReviewEditor } from '../../state/review';

interface Props {
  review: ReviewEditor;
  /** Trazos válidos que hay ahora en el editor. */
  routeCount: number;
  /** Pendientes que se eliminaron del editor y se descartarán. */
  removed: PendingTrace[];
  /** Al evaluar un mapa sin itinerarios: duplas que se registrarán, con las letras de sus trazos. */
  duplas: Map<number, string[]>;
}

/** Explica qué se está resolviendo a mano y qué pasará al pulsar «Guardar y generar». */
export function ReviewBanner({ review, routeCount, removed, duplas }: Props) {
  const removedList = removed.map((t) => `#${t.indice + 1}`).join(', ');
  if (review.mapa) {
    return (
      <div className="suggestion">
        <span>
          Evaluación manual de un mapa sin itinerarios utilizables ({review.totalTrazos} trazos en el reporte). Elimina lo que no sea itinerario (ampliaciones,
          bases…) y deja la ida y el regreso de cada dupla. Se registrarán <b>{duplas.size} dupla(s)</b>, cada una en su carpeta de la ruta y en este orden:{' '}
          {[...duplas.entries()]
            .sort(([a], [b]) => a - b)
            .map(([n, letters]) => `Dupla ${n}: ${letters.join(' ⇄ ')}`)
            .join(' · ')}
          .
          {removed.length > 0 && (
            <b>
              {' '}
              Se descartarán {removed.length} trazo(s) que eliminaste ({removedList}).
            </b>
          )}{' '}
          Todo se puede deshacer desde el centro de control.
        </span>
      </div>
    );
  }
  return (
    <div className="suggestion">
      <span>
        Conflictos pendientes en este mapa: <b>{review.pendientes.length}</b>, cada uno se guardará en su propio KML. Original del mapa: reporte{' '}
        <b>{review.totalTrazos}</b> trazos; editor <b>{routeCount}</b> trazos válidos
        {review.totalTrazos !== routeCount && <span className="cc-err-text"> · el conteo no coincide</span>}. Esto no indica cuántas duplas hay; los nombres se
        proponen con la nomenclatura del lote y puedes editarlos. Organiza duplas, ampliaciones y carpetas; «Guardar y generar» creará los KML individuales de
        los trazos que queden en el editor.
        {removed.length > 0 && (
          <>
            {' '}
            <b>
              Se descartarán {removed.length} trazo(s) que eliminaste ({removedList})
            </b>
            ; puedes deshacerlo desde el centro de control.
          </>
        )}
      </span>
    </div>
  );
}
