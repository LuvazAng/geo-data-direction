# 0002 · IA local con Ollama y Qwen, opcional y validada

**Estado:** aceptada.

## Contexto

Algunos mapas tienen casos que las reglas no resuelven: nombres ambiguos, extremos que no caen en una localidad conocida,
títulos que mezclan origen y destino. Un modelo de lenguaje puede proponer una interpretación, pero:

- las rutas y los textos de trabajo no deben salir del equipo sin que la persona lo decida;
- no debe haber claves ni costos por consulta;
- una respuesta equivocada no puede cambiar un resultado sin que nada la respalde.

## Decisión

- El modelo corre **localmente** con Ollama (`127.0.0.1:11434`); el modelo por omisión es `qwen3.5:4b` (unos 3.3 GB), que
  cabe en una GPU modesta. La URL debe apuntar al equipo local (la configuración lo valida) y el nombre del modelo es
  configurable (`ia.modelo`).
- El orquestador llama a Ollama **directamente** (`/api/chat` con la respuesta restringida por un JSON Schema,
  `think: false`, `temperature: 0`, una petición a la vez, con caché en disco). Un agente para consultas acotadas por mapa
  sería más lento y no aporta nada.
- El modelo recibe un resumen (textos, lugares candidatos, localidades de cada extremo, similitudes ya calculadas), nunca
  coordenadas ni credenciales, y no tiene herramientas.
- Su respuesta **se valida** (índices existentes, nombres dentro de los candidatos, vías presentes en el texto) y sólo se
  aplica si la geometría la confirma; si no, queda en revisión. Lo que dijo siempre va al reporte.
- Es **opcional**: sin Ollama o sin el modelo todo funciona con reglas y los casos dudosos van a revisión. Nada se instala ni
  se descarga sin confirmación (`npm start` lo pregunta la primera vez).
- En el centro de control, Qwen también conversa en el chat, pero lo que escribe nunca se ejecuta: las acciones salen sólo de
  reglas con una lista cerrada o de los botones.

## Alternativas descartadas

- **Un servicio de IA en la nube**: envía datos fuera del equipo, requiere claves y cuesta por consulta.
- **Sin IA**: más casos para resolver a mano.
- **Un agente (Pi CLI) para cada consulta**: 25–80 s por consulta porque el modelo razona aunque se le pida que no. Se deja
  sólo para redactar la explicación de una ejecución.

## Consecuencias

- Es un modelo de 4 mil millones de parámetros: a veces mezcla datos o elige otro criterio, por eso su palabra nunca basta.
- Mientras responde en el chat ocupa el modelo, así que una ejecución en curso espera su turno para consultarlo.
- Si el modelo cambia, hay que revisar que las respuestas sigan pasando la validación; la caché se separa por modelo.
