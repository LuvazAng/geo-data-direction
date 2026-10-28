import { Icon } from '@ui';

interface Props {
  busy: boolean;
  canPickFolder: boolean;
  onPickFolder: () => void;
  onOpenFiles: () => void;
  onOpenTools: () => void;
}

/** Lo que se ve al entrar, sin rutas abiertas: qué hace el editor y cómo empezar. */
export function Welcome({ busy, canPickFolder, onPickFolder, onOpenFiles, onOpenTools }: Props) {
  return (
    <section className="welcome">
      <h2>Empieza abriendo tus rutas</h2>
      <p>Cada recorrido debe ir de INICIO a FINAL, en el sentido en que circula la ruta. Este editor lo comprueba y te deja corregirlo.</p>
      <ol className="steps">
        <li>
          <b>Abre</b> una carpeta, o arrastra a esta ventana tus archivos KML o KMZ.
        </li>
        <li>
          <b>Revisa</b> cada recorrido. El mapa muestra el sentido y el panel dice si coincide con su descripción y con las calles de un sentido.
        </li>
        <li>
          <b>Corrige y guarda.</b> Invierte el sentido, ajusta la forma y guarda cada trazo en su carpeta.
        </li>
      </ol>
      <div className="row">
        {canPickFolder && (
          <button className="primary" onClick={onPickFolder} disabled={busy}>
            <Icon name="folder-open" /> Abrir carpeta
          </button>
        )}
        <button className={canPickFolder ? '' : 'primary'} onClick={onOpenFiles} disabled={busy}>
          <Icon name="file" /> Abrir archivos
        </button>
      </div>
      <p className="small muted">
        ¿Primera vez? En{' '}
        <button className="link" onClick={onOpenTools}>
          Herramientas
        </button>{' '}
        está todo lo que puede hacer el editor, con su glosario y sus atajos.
      </p>
    </section>
  );
}
