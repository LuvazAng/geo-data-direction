import { useCallback, useEffect, useState } from 'react';
import { ControlCenter } from './control/ControlCenter';
import { api } from './control/api';
import { useCentro } from './control/useCentro';
import { Editor } from './editor/Editor';

/** Une el editor de trayectos con el centro de control: cuándo se ve cada uno y cómo se comunican. */
export default function App() {
  // Centro de control: se conecta al servidor la primera vez que se abre y queda conectado
  const [centerOpen, setCenterOpen] = useState(() => window.location.hash === '#centro');
  const [centerUsed, setCenterUsed] = useState(centerOpen);
  const centro = useCentro(centerUsed);
  const centerRunning = Object.values(centro.state.jobs).filter((j) => j.estado.startsWith('EN_')).length;
  useEffect(() => {
    if (centerOpen) setCenterUsed(true);
    const hash = centerOpen ? '#centro' : '';
    if (window.location.hash !== hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [centerOpen]);

  const open = useCallback(() => setCenterOpen(true), []);
  const close = useCallback(() => setCenterOpen(false), []);

  return (
    <Editor
      controlOpen={centerOpen}
      controlRunning={centerRunning}
      onOpenControl={open}
      onCloseControl={close}
      server={api}
      renderControl={(editor) => (
        <ControlCenter
          centro={centro}
          open={centerOpen}
          onClose={close}
          onOpenFile={(file) => {
            // como si se hubiera abierto suelto: "Guardar como" o ZIP para guardar los cambios
            close();
            editor.openFile(file);
          }}
          onOpenReview={(file, lote, traza, indice, nombres, totalTrazos, pendientes, mapa) =>
            void editor.openReview(file, lote, traza, indice, nombres, totalTrazos, pendientes, mapa)
          }
        />
      )}
    />
  );
}
