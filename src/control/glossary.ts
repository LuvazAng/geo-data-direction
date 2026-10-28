// Los términos propios del centro de control, explicados en una frase. Los usan los títulos y el glosario.

export const GLOSSARY = {
  lote: {
    term: 'Lote',
    definition: 'Una zona (por ejemplo SUR u ORIENTE) con su propia configuración: de dónde se leen sus rutas y cómo se nombran los archivos.',
  },
  fuente: {
    term: 'Fuente',
    definition: 'La página de la zona en el sitio de rutas, con sus subpáginas y los mapas de Google My Maps que cada una enlaza.',
  },
  ruta: {
    term: 'Ruta',
    definition: 'Una subpágina de la zona. Reúne los mapas de esa ruta y es la unidad que se procesa.',
  },
  mapa: {
    term: 'Mapa',
    definition: 'Un mapa de Google My Maps de la ruta. Puede traer varios trazos: ida, regreso y ampliaciones.',
  },
  ejecucion: {
    term: 'Ejecución',
    definition:
      'Un trabajo de procesamiento: descarga los mapas de una ruta, decide el origen, el destino y el sentido de cada trazo, y escribe los archivos. También hay ejecuciones que sólo actualizan la fuente.',
  },
  cola: {
    term: 'Cola',
    definition: 'Las ejecuciones que esperan su turno. Un lote sólo ejecuta una a la vez, y el centro tiene un máximo de ejecuciones simultáneas.',
  },
  revision: {
    term: 'Revisión',
    definition: 'Los casos que el orquestador no pudo decidir con evidencia suficiente. Se resuelven a mano en el editor.',
  },
  itinerario: {
    term: 'Itinerario',
    definition: 'Un recorrido principal de ida o de regreso. No cuenta una ampliación ni una copia de otro mapa.',
  },
  manifiesto: {
    term: 'Manifiesto',
    definition:
      'El registro de lo que generó el orquestador, con la huella SHA-256 de cada archivo. Así sabe cuáles archivos son suyos y cuáles cambiaron después.',
  },
  qwen: {
    term: 'Qwen',
    definition:
      'El modelo de IA local (en Ollama). Sólo propone cosas en mapas dudosos y se aceptan únicamente si la geometría las confirma. Lo que escribe en el chat es texto: nunca se ejecuta.',
  },
  pi: {
    term: 'Pi CLI',
    definition: 'Una herramienta externa y opcional. Sólo se usa para redactar la explicación de una ejecución.',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export const define = (key: GlossaryKey) => GLOSSARY[key].definition;
