// Los términos propios del editor, explicados en una frase. Los usan las etiquetas, el glosario y la ayuda.

export const GLOSSARY = {
  'inicio-final': {
    term: 'INICIO y FINAL',
    definition: 'Los extremos del recorrido. El trazo debe ir de INICIO (verde) a FINAL (rojo), en el sentido en que circula la ruta.',
  },
  principal: {
    term: 'Principal',
    definition: 'Recorrido que mide al menos la mitad del trazo más largo del archivo.',
  },
  'tramo-corto': {
    term: 'Tramo corto',
    definition: 'Ampliación o desvío que mide menos de la mitad del más largo. Se une a un recorrido principal.',
  },
  dupla: {
    term: 'Dupla',
    definition: 'La ida y el regreso de una misma ruta: dos recorridos principales que coinciden en el mapa.',
  },
  'ruta-alterna': {
    term: 'Ruta alterna',
    definition: 'Recorrido completo que se arma con una principal y un tramo corto: la principal hasta donde sale el tramo, el tramo, y la principal otra vez.',
  },
  vertice: {
    term: 'Vértice',
    definition: 'Cada punto que forma la línea del trazo. Al editar se pueden mover, agregar o quitar.',
  },
  circuito: {
    term: 'Circuito',
    definition: 'Recorrido cuyo inicio y fin quedan a menos de 500 m, como una vuelta.',
  },
  'calle-un-sentido': {
    term: 'Calle de un sentido',
    definition: 'Calle de OpenStreetMap donde sólo se puede circular en un sentido. El trazo debería ir a favor.',
  },
  tolerancia: {
    term: 'Tolerancia',
    definition: 'Distancia máxima, en metros, para considerar que dos trazos coinciden al compararlos.',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export const define = (key: GlossaryKey) => GLOSSARY[key].definition;
