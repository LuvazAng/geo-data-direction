/** Aviso sobre el mapa mientras se edita la geometría de un trazo. */
export function EditBanner({ letter }: { letter: string }) {
  return (
    <div className="edit-banner">
      Editando <b>{letter}</b> · arrastra vértices o puntos medios · clic derecho quita · <kbd>Ctrl+Z</kbd> deshacer · <kbd>Esc</kbd> terminar
    </div>
  );
}

/** Lo que se ve sobre el mapa cuando no hay trazos abiertos. */
export function EmptyState() {
  return (
    <div className="empty">
      <h2>Arrastra aquí tus KML / KMZ</h2>
      <p>o una carpeta completa (p. ej. GEODATA/RUTAS) para recorrerla carpeta por carpeta.</p>
    </div>
  );
}

/** Capa que aparece mientras se arrastran archivos sobre la ventana. */
export function DropOverlay() {
  return <div className="drop-overlay">Suelta los archivos o la carpeta</div>;
}
