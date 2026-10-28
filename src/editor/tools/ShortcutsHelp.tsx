import { DefinitionList } from '@ui';

const SHORTCUTS: [string[], string][] = [
  [['1', '–', '9'], 'Elegir el trazo que está en esa posición de la lista.'],
  [['R'], 'Invertir el sentido del trazo seleccionado.'],
  [['E'], 'Editar los vértices del trazo; otra vez para terminar.'],
  [['Supr'], 'Quitar el trazo de la lista (no borra archivos del disco).'],
  [['Ctrl', '+', 'Z'], 'Deshacer el último cambio. Sin trazo seleccionado, deshace la última eliminación.'],
  [['F'], 'Encuadrar todos los trazos en el mapa.'],
  [['N'], 'Ir a la carpeta siguiente.'],
  [['P'], 'Ir a la carpeta anterior.'],
  [['Ctrl', '+', 'S'], 'Guardar todo.'],
  [['Ctrl', '+', 'Shift', '+', 'S'], 'Guardar y pasar a la siguiente carpeta.'],
  [['Esc'], 'Terminar la edición o cancelar el ajuste a calles.'],
];

/** Los atajos de teclado del editor. */
export function ShortcutsHelp() {
  return (
    <>
      <DefinitionList
        entries={SHORTCUTS.map(([keys, text]) => ({
          term: keys.map((k, i) => (k === '+' || k === '–' ? <span key={i}> {k} </span> : <kbd key={i}>{k}</kbd>)),
          definition: text,
        }))}
      />
      <p className="small muted">Los atajos no funcionan mientras escribes en un campo de texto.</p>
    </>
  );
}
