# Centro de control

Chat, cola, ejecuciones en curso, carpetas y archivos, consola e historial del procesamiento de rutas, dentro de la app
(botón **Centro de control** en el panel derecho). El motor es el mismo [orquestador](orquestador.md) de la CLI
(`src/orchestrator/pipeline/pipeline.ts`): no hay un segundo motor.

```bash
npm start        # todo junto (Ollama si hace falta + centro + app) y abre http://localhost:5199/#centro
npm run centro   # o por separado: sólo el servidor del centro (127.0.0.1:5198, sólo local)
npm run dev      #                 sólo la app; /api pasa por el proxy de Vite hacia el centro
npm test         # pruebas
```

`npm start` (`tools/start.mjs`) instala dependencias si faltan, ofrece la configuración del primer arranque, inicia
`ollama serve` si Ollama está instalado pero apagado (no descarga modelos por su cuenta), reutiliza un centro que ya esté
corriendo, muestra la salida de todo con etiquetas `[centro]`, `[app]`, `[ollama]` y con Ctrl+C detiene todo (el centro
guarda su estado; lo que estuviera corriendo queda como interrumpido para reintentar).

## La pantalla

El centro se abre encima del editor. Arriba: el estado de la conexión, un resumen («nada en ejecución · 0 en cola · en pausa»),
el botón **Herramientas** y **Editor** para volver. A la izquierda, el chat; a la derecha, cinco pestañas, y cada una abre
con una frase que dice para qué sirve (con los términos *lote*, *ruta*, *ejecución* o *revisión* explicados al pasar el
cursor).

- **Cola:** `Agregar a la cola` es la acción principal. Las variantes (agregar como siguiente, procesar ahora) y las opciones
  avanzadas (sin red, sin IA) están en **Más opciones**. En cada ejecución en espera se ve **Iniciar** y un menú **⋯** con
  el resto.
- **En ejecución**, **Consola** (con sus filtros a la vista y la barra de seguir, pausar la vista, cargar anteriores y
  copiar) e **Historial**.
- **Carpetas y archivos:** una acción por mapa y el resto en **⋯** (ver el [uso](#7-uso)).
- **Chat:** el campo de texto y las sugerencias siempre a la vista; **Ajustes** reúne si Qwen responde en texto y cuánto
  razona.

**Herramientas** abre un cajón con todo lo que puede hacer el centro, agrupado y con su descripción: pausar o reanudar la
cola, procesar la siguiente, actualizar la fuente y encolar las pendientes de cada lote, nuevo chat y el glosario. Ninguna
herramienta desaparece: si no aplica (por ejemplo, sin conexión con el servidor), se ve apagada y dice por qué. Es el mismo
cajón del [editor](editor.md#la-pantalla); su diseño está en [design.md](design.md).

## 1. Arquitectura y decisiones

```
navegador (React, src/control)          Vite (proxy /api + token)          servidor del centro (Node)
  ChatView · QueueView · RunningView  ──fetch POST──▶  ──────────────▶   http.ts  (seguridad, rutas)
  FilesView · ConsoleView ◀──SSE────────   ◀──────────────   hub.ts   (eventos con id, reenvío)
  useCentro (EventSource + reductor)                                       center.ts (chat, acciones, vigilancia de carpetas)
                                                                           jobs.ts   (cola, concurrencia, cancelar, reintentar)
                                                                           runner.ts ──▶ pipeline.run({ scope }) ── el orquestador
                                                                           pi.ts     ──▶ proceso hijo: Pi CLI --mode json (opcional)
                                                                           llm.ts    ──▶ Ollama / qwen3.5:4b (una petición a la vez)
                                                                           persist.ts ─▶ <GEODATA_DIR>/RUTAS_ORQUESTADOR/_centro/
```

Los archivos del servidor están en `src/orchestrator/server/` (salvo `llm.ts`, que es `src/orchestrator/llm/llm.ts`). El
centro es un servidor Node pequeño, sin frameworks (`node:http`), que importa el orquestador directamente.

- **SSE** para eventos (servidor → navegador) y **POST** para acciones: no hace falta un canal bidireccional continuo, y
  EventSource reconecta solo.
- **Persistencia en JSON/JSONL** junto a los lotes, igual que el orquestador; no depende de ninguna base de datos.
- **Unidad de trabajo = subpágina (ruta)**, la misma del orquestador. Para que procesar una ruta no afecte a las demás, el
  orquestador acepta `scope`: clasifica todo el lote como contexto (≈3 s; los códigos y nombres no cambian según lo que se
  elija) pero sólo descarga, consulta a la IA y escribe los archivos de esa ruta. La CLI usa lo mismo: `--rutas ruta-2-sur`.
- **Pi CLI** (opcional, una herramienta externa) se usa donde aporta un flujo de agente: redactar la explicación de una
  ejecución («explica la última ejecución con Pi»). El procesamiento llama a Qwen directo (con Pi, cada consulta tardaba
  25–80 s porque Qwen razona aunque se pida `--thinking off`).

## 2. Dónde está cada cosa

| Archivo | Qué hace |
| --- | --- |
| `src/protocol/events.ts` | Eventos del orquestador (registro, etapa, avance, archivo) por componente |
| `src/protocol/centro.ts` | Contrato servidor ↔ navegador (tipos, acciones permitidas, eventos) |
| `src/orchestrator/server/http.ts` | API: token, Host, Origin, JSON, límites; rutas `/api/*` |
| `src/orchestrator/server/hub.ts` | SSE con ids `<bootId>:<seq>`, búfer para reenviar y latido |
| `src/orchestrator/server/jobs.ts` | Cola, ejecuciones, concurrencia, cancelar/reintentar, recuperación |
| `src/orchestrator/server/runner.ts` | Ejecuta una ejecución con `pipeline.run` |
| `src/orchestrator/server/center.ts` | Fachada que une todo: estado, chat, acciones validadas |
| `src/orchestrator/server/actions.ts` | Validación y etiqueta de las acciones permitidas |
| `src/orchestrator/server/chat.ts` | Intenciones (reglas + Qwen con lista cerrada) y respuestas |
| `src/orchestrator/server/conversa.ts` | Contexto de la conversación con Qwen: instrucciones, resumen del estado, historial, lo que hizo el centro |
| `src/orchestrator/server/conversations.ts` | Conversaciones del chat (se guardan y se publican) y construcción de mensajes |
| `src/orchestrator/server/replies.ts` | Respuesta de Qwen en vivo: turnos, streaming, razonamiento y «Detener» |
| `src/orchestrator/server/nombres.ts`, `llm/siglas.ts` | Siglas de las colonias para el asistente de nombres del editor (`POST /api/nombres/siglas`): catálogo → Qwen → regla |
| `src/orchestrator/server/watcher.ts` | Vigilancia de las carpetas de los lotes |
| `src/orchestrator/server/pi.ts`, `explica.ts` | Pi CLI como proceso hijo seguro y el resumen que se le da |
| `src/orchestrator/server/views.ts` | Rutas, carpetas y archivos (estado según estado.json y manifiesto) |
| `src/orchestrator/pipeline/reviews/` | Diagnóstico geométrico, guardado de decisiones, generación y deshacer de casos revisados |
| `src/orchestrator/server/logs.ts`, `persist.ts`, `sanitize.ts`, `config.ts`, `index.ts` | Registros, persistencia, sanitización, configuración, arranque |
| `src/control/` | Interfaz: `ControlCenter` (encabezado, pestañas y cajón de Herramientas en `ControlTools`), `chat/`, `queue/` (cola y ejecución), `files/`, `logs/` (consola e historial), `details/`, y `useCentro`, `state`, `api`, `common`, `tools` (estado de las herramientas) y `glossary` |
| `tests/orchestrator/server/*`, `tests/control/*` | Pruebas del centro y de la interfaz |

## 3. Frontend ↔ backend y eventos

- El navegador abre **un** `EventSource('/api/eventos')`. Primero recibe `snapshot` (estado completo) y después:
  `job.created`, `job.queued`, `job.started`, `job.stage_changed`, `job.progress`, `job.log`, `job.file_detected`,
  `job.file_updated`, `job.completed`, `job.failed`, `job.cancelled`, `queue.updated`, `routes.updated`, `folder.updated`,
  `chat.message`, `models.updated`, más `latido` cada 15 s.
- **Reconexión**: EventSource manda `Last-Event-ID`; si es de esta instancia del servidor y sigue en el búfer
  (`retencion.eventos`), se reenvía sólo lo perdido; si no (servidor reiniciado, hueco grande), llega un `snapshot` nuevo.
  Sin eventos ni latidos por 40 s, la interfaz marca la conexión como caída y reconecta. Reconectar nunca crea ni reinicia
  ejecuciones.
- Las acciones son `POST` (JSON). El chat y los botones sólo pueden pedir acciones de `ACTION_TYPES` (encolar, mover al
  frente, iniciar, ejecutar siguiente, reintentar, cancelar, pausar, reanudar, detalles, actualizar fuente, explicar con
  Pi); el servidor valida tipo, campos, lote autorizado y existencia de la ruta/ejecución.
- **Carpetas**: `fs.watch` sobre cada lote (los cambios se agrupan cada 0.4 s) + los eventos de archivo del orquestador. La
  vista de archivos pide `/api/archivos` de nuevo cuando cambian; el estado de cada archivo sale de `estado.json` y del
  manifiesto (huella SHA-256), nunca de que aparezca en la carpeta. Lo que está en `resultados/` sin registro se muestra
  aparte.

## 4. Cola, ejecuciones y persistencia

| Control (dónde está) | Qué hace de verdad |
| --- | --- |
| Encolar | Crea una ejecución `PENDIENTE`. Si ya hay una pendiente o en curso para esa ruta, o una con la misma clave de idempotencia, devuelve esa |
| Pausar / Reanudar la cola (**Herramientas**) | No se toman ejecuciones nuevas; la que corre termina normalmente |
| Procesar la siguiente (**Herramientas**) / Iniciar (en cada ejecución de la cola) | Funciona con la cola en pausa (modo manual). Si el lote ya está ocupado, la deja al frente |
| Subir, Bajar y Poner al frente (menú **⋯** de cada ejecución en cola) | Sólo cambia el orden de las pendientes; nunca reinicia la que corre |
| Cancelar pendiente | Inmediato |
| Cancelar en curso | El orquestador se detiene en el siguiente punto seguro (entre etapas, entre mapas, entre consultas a Qwen); una descarga o consulta ya iniciada termina primero. En la etapa de salida no se acepta |
| Reintentar | Ejecución **nueva** desde el principio (no vuelve a descargar ni reescribe lo igual); no se presenta como reanudación |
| Reinicio del servidor | Lo que corría queda `INTERRUMPIDO` con su motivo; las pendientes y la pausa se conservan |

Estados: `PENDIENTE`, `EN_DESCARGA` (fuente, descarga), `EN_ANALISIS`, `EN_CLASIFICACION` (clasificación, comparación, Qwen,
nombres), `EN_GENERACION` (salida, reporte), `COMPLETADO`, `COMPLETADO_CON_ADVERTENCIAS` (la interfaz muestra «Esperando
revisión» si hay casos en revisión), `FALLIDO`, `CANCELADO`, `INTERRUMPIDO`. El avance sólo se muestra en la descarga (mapas N
de M).

Concurrencia: `maxSimultaneas` (1 por omisión) en total y **un lote a la vez**: comparten estado y resultados. Además el
orquestador toma `<lote>/.lock`, así que la CLI y el centro no pueden escribir el mismo lote a la vez (un candado de un
proceso muerto se recupera).

Persistencia en `<GEODATA_DIR>/RUTAS_ORQUESTADOR/_centro/`: `ejecuciones.json` (id, unidad, estado, etapa, fechas,
parámetros, resultado, errores, archivos de entrada y salida), `cola.json`, `registros/<id>.jsonl`,
`registros/sistema.jsonl`, `chat.jsonl`, `conversaciones.json`. Escritura atómica. El reporte de cada ejecución queda en
`<lote>/ejecuciones/<id>/reporte.{md,json}`.

## 5. Registros reales de Pi CLI y Qwen

- **Orquestador**: cada etapa emite eventos con componente (`ORCHESTRATOR`, `SOURCE`, `DOWNLOAD`, `GEOMETRY`, `CLASSIFY`,
  `QWEN`, `OUTPUT`), ruta, mapa y duración.
- **Qwen**: el runtime (Ollama, `format` + `think:false`) no expone pasos intermedios ni tokens en streaming; se registra lo
  observable: la tarea enviada (sin coordenadas), cuándo empieza, cuánto tarda, si se reintentó, la respuesta validada y lo
  descartado. «¿Qué está haciendo Qwen?» lee la compuerta del proceso (tarea actual, en espera, última) y `/api/ps` de
  Ollama.
- **Qwen en el chat** (interruptor «Qwen responde» en **Ajustes** del chat, activo por omisión): a cada mensaje escrito, además de la respuesta del
  centro, Qwen contesta en texto, en streaming (`/api/chat` de Ollama con `stream: true`). Recibe las instrucciones, un
  resumen del estado (lotes, rutas, cola, lo que corre, últimas ejecuciones; sin coordenadas ni rutas del equipo), los
  últimos 8 turnos **de la conversación actual** y lo que el centro respondió o hizo. Se muestran la fase (esperando turno,
  leyendo el contexto, razonando, respondiendo), «Detener» y lo que mide Ollama: duración, carga del modelo, primer token,
  tokens de contexto y generados, tok/s, esfuerzo y si se recortó el razonamiento. Lo que escribe Qwen nunca se ejecuta: las
  acciones siguen saliendo sólo de las reglas/la clasificación con lista cerrada o de los botones. Si el centro no reconoce
  el mensaje, o es un saludo («¡hola!», «gracias»: no pasa ni por el clasificador), contesta sólo Qwen. Las respuestas van de
  una en una y comparten la compuerta del modelo con el procesamiento. Se registran en la consola (componente `QWEN`) y en
  `chat.jsonl`. `POST /api/chat` acepta `conversacion`, `conversar` y `esfuerzo`; `POST /api/chat/detener` (`id` opcional)
  detiene la respuesta.
  - **Esfuerzo de razonamiento** (selector «Razonamiento» en **Ajustes** del chat): `ninguno` (`think: false`), `bajo` (256 tokens, por omisión),
    `medio` (1 024), `alto` (3 072). Ollama no limita el razonamiento de qwen3.5 (`think: "low"` se acepta pero no cambia
    nada), así que el presupuesto se aplica aquí: se cuentan los trozos de razonamiento (uno por token) y al agotarlo sin
    haber empezado a responder se corta la petición y se continúa en `/api/generate` con `raw: true`, el formato de Qwen
    (ChatML) y su cierre recomendado («Considering the limited time by the user, I have to give the solution based on the
    thinking directly now. </think>»): responde con lo que ya pensó en vez de razonar hasta llenar el contexto. Se quitan del
    texto las marcas del formato (`<|im_start|>`, `<think>`) para que nadie pueda abrir otro turno. `num_predict` =
    presupuesto + 1 536 para la respuesta; `num_ctx` 8192, el mismo del procesamiento, para no recargar el modelo.
  - **Conversaciones** (selector y «Nuevo chat»): cada mensaje lleva su conversación y Qwen sólo relee los de la
    conversación en la que se le pregunta; una nueva empieza sin historial. Toma el título de su primer mensaje; si ya hay
    una vacía, «Nuevo chat» usa esa. «Esta ruta» / «esa ejecución» también se recuerdan por conversación. Los mensajes de
    antes quedan en «Mensajes anteriores». Se guardan en `conversaciones.json`; `GET/POST /api/conversaciones`,
    `GET /api/chat?conversacion=…`, `POST /api/acciones` con `conversacion`, evento `chat.conversation`. La conversación
    elegida se recuerda en el navegador.
  - **Streaming palabra por palabra**: mientras Qwen escribe, el servidor manda sólo lo nuevo (`chat.delta`: id, `rev`, fase
    y el texto/razonamiento agregado) hasta ~25 veces por segundo, y cada 1.5 s la versión completa (`chat.message`). Ambos
    van sin id y no se guardan en el búfer de reenvío (`publishVolatile`); sí se guardan la versión inicial y la final. El
    navegador aplica un trozo sólo sobre la versión inmediatamente anterior; si perdió uno, espera la siguiente versión
    completa. Se sanitiza el texto acumulado y se manda la diferencia; si la sanitización cambió algo ya enviado, va la
    versión completa.
  - **Markdown**: respuesta y razonamiento se muestran con `src/control/chat/markdown.tsx` (títulos, negritas, cursivas, tachado,
    código, listas anidadas/numeradas/de tareas, tablas, citas, enlaces http(s)), convertido a elementos de React, nunca HTML
    crudo. Tolera texto a medias: marcas sin cerrar se ven tal cual hasta que se cierran. Un cursor ▍ marca que sigue
    escribiendo.
  - El resumen del estado agrupa las rutas de cada lote por estado (de las terminadas, sólo el nombre), para que un lote
    grande no deje fuera a los demás.
- **Pi CLI** (opcional): proceso hijo `node pi-launcher.js --mode json --no-tools --no-session --no-extensions --no-mcp
  --no-skills --no-prompt-templates --no-context-files --no-themes --no-approve --offline --provider ollama --model
  qwen3.5:4b`, sin shell, con entorno mínimo y en una carpeta vacía. Se registra cada evento JSONL relevante (inicio,
  razonamiento con su tamaño, escritura, fin, reintentos, intentos de herramienta) y cada línea de stderr; el texto que va
  escribiendo llega al chat tal cual (streaming real). Si Pi corta por longitud, se avisa.
- **Siglas para nombrar a mano** (`POST /api/nombres/siglas`, lo usa el asistente *Sugerir nombre* del editor al resolver un
  mapa): recibe `{ lote, traza, lugares[1–12] }` y responde el código de la ruta (del reporte del lote, de la traza
  pendiente que se le indica), las siglas de cada lugar con su origen (`config`, `aprendido`, `sugerido`, `qwen` o
  `regla`) y qué pasó con la IA (`habilitada`, `usada`, `modelo`, `ms`, `error`, `descartes`). Un lugar que ya tiene siglas
  en el catálogo del lote (configuración > aprendido > sugerido en el reporte) no se pregunta a Qwen; los demás van en **una**
  consulta con `structured()` (esquema JSON, sin razonamiento, temperatura 0, ejemplos del catálogo y siglas ocupadas) y
  cada respuesta se valida en el servidor: formato de 2 a 6 mayúsculas o cifras, que salga del nombre del lugar y que no
  sea de otro lugar. Lo que no pasa se descarta (queda en `descartes`) y ese lugar usa la regla de siglas con una cifra
  si choca. Si la IA está desactivada o Qwen no responde, la respuesta es igualmente útil y lo dice. 409 si el lote aún
  no tiene reporte; 404 si la traza o su ruta no están en él. Aparece en la consola como `QWEN` (origen `editor`).
- Todo pasa por `sanitize.ts`: JWT, `Bearer`, claves (`sk-…`, `AIza…`, `ghp_…`), `password=`, credenciales en URLs, claves
  sensibles en datos estructurados y la carpeta personal (→ `~`).

## 6. Configuración

`config/lotes/centro.json` (opcional) o variables de entorno (también desde `.env`):

| Variable / clave | Por omisión | Para qué |
| --- | --- | --- |
| `CENTRO_PORT` / `port` | 5198 | Puerto del centro (sólo 127.0.0.1) |
| `CENTRO_DATOS` / `datos` | `<trabajo>/_centro` | Ejecuciones, registros, chat |
| `CENTRO_TOKEN_ARCHIVO` | `.centro/token` | Token local (se crea solo; Vite lo lee) |
| `CENTRO_MAX_SIMULTANEAS` / `maxSimultaneas` | 1 | Ejecuciones a la vez (1–4) |
| `CENTRO_URL` (Vite) | `http://127.0.0.1:5198` | Destino del proxy `/api` |
| `lotes` | todos los `config/lotes/*.json` | Lotes autorizados |
| `origenes` | `localhost:5199` | Orígenes del navegador aceptados |
| `autoIniciar` | true | Seguir con la cola al arrancar si no estaba en pausa |
| `retencion.*` | 200 ejecuciones, 5000 registros c/u, 3000 en memoria, 3000 eventos, 500 mensajes | Límites |
| `PI_NODE`, `PI_LAUNCHER`, `pi.timeoutMs` | node de Pi, `~/.pi/agent/bin/pi-launcher.js`, 240 s | Pi CLI (opcional) |

**Seguridad.** El centro sólo escucha en `127.0.0.1`, exige el token local (el proxy de Vite lo agrega; el navegador nunca lo
ve), rechaza `Host` ajenos (DNS rebinding) y `Origin` que no sean la app, y sólo acepta POST con JSON (un formulario de otro
sitio no puede enviarlo sin CORS, que no se habilita). Los archivos se limitan a `originales/` y `resultados/` de los lotes
configurados. Más en [SECURITY.md](../SECURITY.md) y en [adr/0003-token-local-del-centro.md](adr/0003-token-local-del-centro.md).

## 7. Uso

1. `npm start` (o `npm run centro` y, en otra terminal, `npm run dev`).
2. Se abre la app en el **Centro de control** (también con el botón del panel derecho). El chat entiende, entre otras:
   «muéstrame las rutas pendientes», «procesa la siguiente ruta», «quiero seleccionar manualmente cuál sigue», «procesa la
   ruta 2», «muéstrame los archivos que fallaron», «¿qué está haciendo Qwen?», «muéstrame los últimos mensajes de Pi CLI»,
   «reintenta la ruta 2», «¿qué archivos se generaron y dónde?», «abre los detalles de la ruta 4», «explica la última
   ejecución con Pi».
3. En **Carpetas y archivos**, la columna **Qué hacer** muestra, en cada mapa, la acción que toca ahora y el resto en el menú **⋯**. Pulsa **Resolver conflictos** en el mapa con casos pendientes para cargar el KML/KMZ
   original completo del mapa (no solo la copia del trazo pendiente). Ajusta geometrías, duplas, ampliaciones y carpetas;
   **Guardar y generar** registra cada conflicto pendiente como un KML individual con su nombre, no como un solo KML
   combinado, y conserva la geometría editada en futuras ejecuciones. También puedes descartar casos individuales o
   seleccionados y deshacer decisiones desde esa vista.
4. Un mapa **sin itinerarios utilizables** muestra el motivo (p. ej. «2 ampliación(es)», «copia de «20.-…»») y tres salidas:
   **Volver a revisar** (en el encabezado de la ruta: la vuelve a clasificar sin red con los originales guardados; lo
   resuelto a mano se conserva), **Evaluar a mano** (abre el original en el editor; lo que dejes se registra agrupado por las
   duplas que muestra el editor, cada dupla en su carpeta en el lugar del mapa dentro de la ruta, y las de los mapas
   siguientes se recorren) y **Descartar el mapa** (en el menú **⋯** del mapa; queda `DESCARTADO`: no se genera nada de él y la ruta deja de esperar su
   revisión). Todo se deshace desde la misma vista (`POST /api/revisiones/mapa`, `POST /api/revisiones/decidir-mapa`).
5. Cerrar o recargar la página no detiene nada: las ejecuciones viven en el servidor.

## 8. Pruebas

`npm test`. Las del centro (`tests/orchestrator/server`, `tests/control`) cubren: seguridad (token, Host, Origin, JSON,
tamaño, acciones y rutas de archivo no permitidas), cola (automática, pausa + manual, reordenar sin reiniciar, al frente,
iniciar), duplicados e idempotencia, concurrencia (un lote a la vez, límite global), cancelar pendiente/en curso/en salida,
fallo y reintento, recuperación tras reinicio, retención, registros sanitizados, SSE (estado inicial, reenvío con
Last-Event-ID, estado completo tras reinicio, sin duplicar), chat (las frases de ejemplo, rutas ambiguas, pedidos fuera de lo
permitido, Qwen inválido o ausente), conversación con Qwen (streaming de razonamiento y respuesta con un Ollama simulado,
contexto que recibe, historial, detener en curso o en espera, inactividad, errores, versiones viejas que no pisan a las
nuevas, respuestas huérfanas tras reiniciar, streaming por trozos sin búfer de reenvío y trozos perdidos), markdown (formato,
listas, tablas, código, texto a medias, sin HTML ni enlaces que no sean http(s)), Pi (captura real de stdout/stderr con un Pi
simulado, tiempo agotado, no dos a la vez, ausente) y el reductor del navegador.

## 9. Limitaciones

- El orquestador corre en el mismo proceso que el servidor; cede el turno entre bloques de cálculo, pero un bloque puede
  demorar las respuestas hasta ~0.6 s.
- Una descarga o consulta a Qwen ya iniciada no se interrumpe: la cancelación espera a que termine (como máximo su tiempo de
  espera).
- El orquestador no se puede pausar a mitad de una etapa: «pausar» es de la cola.
- Qwen a través de Pi razona aunque se pida `--thinking off` (25–80 s por explicación).
- Qwen en el chat, medido con qwen3.5:4b: sin razonar 1–3 s; esfuerzo bajo ~17 s; medio ~30 s; sin presupuesto llegó a razonar
  4 096 tokens (93 s) ante un «¡Holaaa!» sin llegar a responder, por eso existe el presupuesto. Razona en inglés. Mientras
  responde ocupa el modelo, así que una ejecución en curso espera su turno para consultar a Qwen. Es un modelo de 4B: a veces
  mezcla datos o elige un criterio distinto (verificar las cifras con lo que muestra el centro).
- El centro no tiene autenticación de usuarios, sólo el token local: si se expone Vite en la red (`--host`), conviene ponerlo
  detrás de un acceso autenticado.
