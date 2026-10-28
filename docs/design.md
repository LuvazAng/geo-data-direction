# Diseño de la interfaz

Guía de diseño del editor de trayectos y del centro de control: qué se quiere lograr, cómo se ve y qué reglas
siguen los componentes. Estado: **editor y centro de control implementados (fases 1 y 2)**. Para el uso del editor ver
[editor.md](editor.md) y del centro de control [centro-de-control.md](centro-de-control.md).

## 1. Contexto del producto

- **Producto:** editor de trayectos KML/KMZ (fijar el sentido INICIO → FINAL, detectar ida/regreso, organizar
  carpetas, corregir geometría) y centro de control (cola, ejecuciones, archivos, consola, historial y chat del
  orquestador).
- **Quién lo usa:** (a) quien revisa cientos de recorridos y necesita rapidez; (b) cualquier persona que prueba el
  sistema por primera vez y no conoce términos como _dupla_, _tramo corto_ o _vértice_.
- **Tarea principal:** abrir rutas → comprobar que cada recorrido va de INICIO a FINAL → corregir si hace falta →
  guardar. Sin tener que adivinar dónde está cada herramienta.
- **Criterios de éxito:**
  1. Una persona nueva abre una carpeta, entiende lo que ve de un trazo y guarda, sin leer documentación.
  2. Ninguna tarjeta muestra más de 6 controles a la vez; cada herramienta está a lo más a 2 clics del botón
     **Herramientas**.
  3. Toda herramienta es alcanzable **en cualquier momento**: si no aplica, se ve apagada y dice por qué.
  4. No se pierde ninguna función ni atajo actual.
- **Debe aparecer:** letra y nombre del trazo, km y puntos, direcciones de INICIO y FINAL, coincidencia con la
  descripción, calles de un sentido, colonias, comparación de pares, duplas, árbol de carpetas, estado de guardado.
- **Restricciones técnicas:** React 19 y CSS propio (sin Tailwind ni biblioteca de componentes), MapLibre, Chrome o
  Edge, español de México. Sin dependencias nuevas. La capa `editor` solo importa de `core` y `protocol`
  ([architecture.md](architecture.md)). La lógica (`state/`, `hooks/`, `services/`) no cambia.

## 2. Lectura de la interfaz actual

- **Vocabulario visual:** tema oscuro azul pizarra (`#0f172a`, `#111827`, `#1f2937`), acento azul, tipografía del
  sistema a 14 px, radios de 6–10 px, iconos hechos con caracteres (◉ ✕ ⇄ ⌖ ⤓ ✎).
- **Se conserva:** el tema oscuro, la letra con el color de cada trazo, INICIO verde y FINAL rojo, los atajos de
  teclado y que el centro de control se abra encima del editor.
- **Problemas medidos:**
  - La tarjeta del trazo seleccionado reúne unas 15 funciones (la antigua `RouteCard`).
  - La barra del mapa mezcla mapa base, sentidos, colonias y opacidad.
  - El pie muestra siempre 9 atajos junto a 3 botones de guardado.
  - Las herramientas de geometría solo existen con un trazo seleccionado; «Separar en carpetas por dupla» solo con
    más de 2 trazos relacionados.
  - Los botones principales llevan texto blanco sobre `#3b82f6`: contraste 3.68:1, por debajo del 4.5:1 mínimo.
  - La letra de cada trazo es siempre blanca sobre su color: de 1.98:1 (lima) a 3.96:1 (morado); con ámbar, turquesa y
    lima apenas se lee.
  - No hay estilos `:focus-visible`: el foco del teclado depende del navegador.
  - Las secciones se rotulan en MAYÚSCULAS con interletrado, y los términos propios no se explican.
- **Se transforma:** tarjeta → fila compacta + inspector esencial; barra del mapa → selector de mapa base +
  «Capas»; pie → una acción principal; atajos → ayuda bajo demanda.
- **Se elimina:** etiquetas en mayúsculas, la línea fija de atajos, botones con solo un carácter y párrafos
  explicativos dentro de las tarjetas (pasan a texto de apoyo o ayuda).
- **Ya existe y se respeta:** `prefers-reduced-motion` en tres bloques, punto de quiebre a 900 px, estados
  deshabilitados, `role="status"` en cargas.

## 3. Dirección de gusto

- **Identidad:** una mesa de trabajo oscura y tranquila donde el recorrido —de INICIO a FINAL— es lo único con color
  y protagonismo.
- **Dirección:** _Cabina ordenada_. Mismo carácter oscuro (predeterminado) con un tema claro opcional, jerarquía por
  escalones de luminosidad en vez de cajas por todas partes, una sola acción principal por zona y textos que explican
  en lenguaje llano.
- **Evitar:** tablero tipo «cockpit» con gradientes, vidrio, tarjetas de métricas o iconos de relleno.
- **Qué debe sentirse distinto:** la **línea de recorrido** (● INICIO ━━▶ FINAL ●) en cada trazo, con su color. Es lo
  que esta herramienta decide, así que es lo memorable.
- **Qué debe quedar en silencio:** superficies neutras, bordes tenues, un solo acento azul.

## 4. Referencias

**Linear** (solo oficio, con moderación):

- Transferible: superficies por escalones de luminosidad, bordes semitransparentes, un único acento, énfasis con peso
  medio (500) en vez de negrita.
- No transferible: Inter y Berkeley Mono, el índigo de marca, titulares de marketing, degradados.
- Sustituciones: se mantiene el azul y la tipografía del sistema.
- Riesgo: que los bordes tenues se pierdan sobre el mapa o en monitores de poco contraste.
- Si estorba: volver al borde sólido `--border` actual.

## 5. Tema visual y atmósfera

- **Tesis:** calma operativa. Mucho espacio alrededor de lo importante y poco peso en lo secundario.
- **Tono:** tranquilo, guiado, de confianza. **Personalidad:** un guía paciente que habla de tú y con verbos.
- **Primera vista:** el mapa y un panel que dice «Empieza abriendo tus rutas» con tres pasos (abrir, revisar,
  guardar) y los botones para hacerlo.
- **Prioridad de peso:** 1) el mapa y los trazos, 2) la línea de recorrido del trazo seleccionado, 3) la acción
  principal de guardar, 4) todo lo demás.

## 6. Color y roles

Dos temas con los mismos roles. El oscuro es el predeterminado; el claro se elige en **Herramientas → Mapa y
apariencia** y se recuerda en el navegador. Cada tema es un conjunto de variables CSS bajo `data-theme` en `<html>`;
el CSS de los componentes no cambia. El mapa base (Calles, Satélite, Oscuro) es independiente del tema.

### Tema oscuro (predeterminado)

| Rol                      | Valor                                       | Uso                                         |
| ------------------------ | ------------------------------------------- | ------------------------------------------- |
| Fondo de la app          | `#0f172a` (igual)                           | huecos, fondo del mapa                      |
| Panel                    | `#111827` (igual)                           | columna lateral, centro de control          |
| Superficie               | `#182132`                                   | filas y secciones                           |
| Superficie elevada       | `#1f2a3d`                                   | menús, trazo seleccionado, ventanas         |
| Hover                    | `#273449` (el actual `--card-hi`)           | pasar el cursor                             |
| Texto principal          | `#e5e7eb` (igual)                           | 14.3:1 sobre el panel                       |
| Texto secundario         | `#cbd5e1`                                   | descripciones                               |
| Texto atenuado           | `#94a3b8` (igual)                           | metadatos, 6.9:1 sobre el panel             |
| Acento (`--accent`)      | `#2563eb` con texto blanco                  | 5.2:1; antes era `#3b82f6` con 3.7:1        |
| Selección y foco (`--accent-hi`) | `#3b82f6`; enlace `#60a5fa`        | enlace 7.0:1 sobre el panel                 |
| Borde                    | `rgba(148,163,184,.16)`; fuerte `.28`       | sustituye al sólido en separaciones         |
| Borde de controles       | `#334155` (igual)                           | campos y botones                            |
| Anillo de foco           | 2 px `#7cb0ff`, separado 2 px               | todo control con teclado                    |
| Correcto / aviso / error | relleno `#22c55e` / `#f59e0b` / `#ef4444`; texto `#86efac` / `#fcd34d` / `#fca5a5` | solo estados, nunca decoración |
| Trazos                   | colores actuales de `route.color`           | único color saturado fuera de los estados   |

### Tema claro

| Rol                      | Valor                                       | Uso                                         |
| ------------------------ | ------------------------------------------- | ------------------------------------------- |
| Fondo de la app          | `#e2e8f0`                                   | huecos, fondo del mapa                      |
| Panel                    | `#f8fafc`                                   | columna lateral, centro de control          |
| Superficie               | `#ffffff`                                   | filas y secciones                           |
| Superficie elevada       | `#ffffff` con sombra suave                  | menús, ventanas                             |
| Hover                    | `#eef2f7`                                   | pasar el cursor                             |
| Texto principal          | `#0f172a`                                   | 17.1:1 sobre el panel                       |
| Texto secundario         | `#334155`                                   | 9.9:1                                       |
| Texto atenuado           | `#64748b`                                   | 4.6:1 sobre el panel, 4.8:1 sobre superficie |
| Acento (acciones)        | `#2563eb` con texto blanco                  | 5.2:1                                       |
| Enlace y anillo de foco  | `#1d4ed8`                                   | 6.4:1 sobre el panel                        |
| Borde                    | `rgba(15,23,42,.12)`; fuerte `.22`          | separaciones                                |
| Borde de controles       | `#cbd5e1`                                   | campos y botones                            |
| Correcto / aviso / error | `#15803d` / `#b45309` / `#b91c1c`           | 4.8:1 / 4.8:1 / 6.2:1 sobre el panel        |

### Reglas comunes

- El acento solo marca la acción principal y la selección; los colores de estado no se usan de adorno.
- **Distintivo del trazo** (la letra): siempre tinta oscura `#020617`, que da entre 5.1:1 y 10.2:1 con los 8 colores de
  trazo (la blanca daba 2.0–4.0:1). En el tema claro lleva además un borde de 1 px del mismo color más oscuro. La letra
  ya identifica al trazo, así que el color nunca es la única señal.
- INICIO verde y FINAL rojo son puntos de color con su palabra al lado; no dependen solo del tono.

## 7. Tipografía

- **Familia:** `"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`. Sin fuentes nuevas.
  Mono (atajos, rutas de archivo): `ui-monospace, "Cascadia Mono", Consolas, monospace`.
- **Escala:** 12 (apoyo) · 13 (denso) · 14 (cuerpo) · 15 (títulos de sección) · 18 (título del panel).
- **Títulos de sección:** 15 px, peso 600, en minúsculas normales, sin interletrado. Describen, no etiquetan:
  «Carpetas y trazos», no «CARPETAS».
- **Pesos:** 400 lectura, 500 énfasis de interfaz, 600 títulos. **Interlineado:** 1.45 en texto, 1.3 en títulos.
  **Interletrado:** normal. Líneas de lectura de menos de 80 caracteres (el panel ya lo garantiza).

## 8. Componentes

- **Botón:** tres niveles. _Principal_ (fondo `#2563eb`), _normal_ (superficie elevada con borde) y _discreto_
  (solo texto e icono). Unos 32 px de alto, radio 8 px, icono SVG + palabra; nunca solo un carácter. Foco con anillo;
  deshabilitado al 45 % y, en el cajón, con el motivo escrito en la fila.
- **Botón Herramientas:** en el encabezado del panel, siempre visible. Abre un **cajón dentro del panel** que cubre la
  lista de trazos; «Volver» (o Esc) regresa a ella. El cajón tiene encabezado fijo, grupos y filas con: icono, verbo,
  descripción completa de una o dos líneas, atajo y estado. Hay espacio para explicar, así que se lee como una guía.
  - _Disponible_: se puede usar ya. _Recomendado ahora_: punto de acento y texto breve (solo cuando hay una señal
    real: «A parece ir al revés», dupla en el mismo sentido, descripción que no coincide). _No disponible_: apagada y
    con el motivo escrito en la fila («Selecciona un trazo»), nunca oculta.
  - Al usar una herramienta el cajón se cierra y el trazo queda a la vista. Las herramientas con ajustes (simplificar,
    ajustar a calles, editar vértices) muestran sus controles en el inspector **solo mientras están activas** y los
    guardan al terminar.
  - Grupos: **Abrir y guardar** · **Trazo seleccionado** (invertir, editar vértices, simplificar, ajustar a calles,
    restaurar, ver, opacidad) · **Organizar** (nueva carpeta, separar por dupla, tolerancia de comparación) ·
    **Mapa y apariencia** (mapa base, separar sentidos, colonias, opacidad general, tema claro/oscuro) · **Ayuda**
    (atajos, glosario).
- **Fila de trazo (compacta):** letra con color, nombre, línea de recorrido, km y a lo más 2 etiquetas (el resto en
  «+N» con su detalle al pasar el cursor).
- **Inspector del trazo seleccionado:** solo lo esencial, sin pestañas.
  1. _Cabecera_: letra, nombre, línea de recorrido y las acciones **Invertir sentido** y **Ver**.
  2. _Sentido_: INICIO y FINAL con su dirección, si coincide con la descripción, calles de un sentido y el estado de
     los marcadores del archivo.
  3. _Guardar_: carpeta, nombre, dónde se escribirá y el botón de guardar.
  4. _Colonias_ (N): sección plegada; se abre para ver la lista en orden de recorrido.
  5. _Herramienta activa_: solo aparece al activar Forma desde **Herramientas** (editar vértices, simplificar o ajustar
     a calles), con sus controles y **Aplicar / Cancelar**. Mientras está activa, el bloque _Guardar_ se pliega.
     Al terminar, la herramienta desaparece y _Guardar_ vuelve.

  Controles a la vez: Invertir, Ver, carpeta, nombre, Guardar y el plegable de Colonias son 6. Con una herramienta
  activa, sus controles (por ejemplo deslizador, Aplicar y Cancelar) reemplazan a los de _Guardar_. La fila del trazo
  lleva aparte ocultar y quitar. Así se cumple el límite del punto 2 de los criterios de éxito.
- **Duplas y tramos cortos:** antes ocupaban casi todo el panel (cada tramo corto muestra selector, vértices y dos
  botones). Cada dupla pasa a una tarjeta con sus letras, el % de coincidencia y el veredicto (ida y regreso ✓ o mismo
  sentido ⚠). Cada tramo corto es una fila de una línea: letra, nombre, relación («Extensión de B») y el botón **Crear
  ruta alterna B + C**. «Unir con» y los vértices de salida y reincorporación quedan tras **Ajustar unión**, plegado.
  La sección completa va **después** de la lista de trazos y plegada, con un contador («Duplas y ampliaciones · 2»).
- **Etiquetas con ayuda:** _principal_, _tramo corto_, _dupla_, _vértice_ llevan una definición corta al pasar el
  cursor o con el foco. «Dupla = la ida y el regreso de una misma ruta».
- **Barra del mapa:** selector segmentado Calles · Satélite · Oscuro y un botón **Capas** (separar sentidos, todas
  las colonias, opacidad general).
- **Pie del panel:** una acción principal (**Guardar todo** o **Descargar ZIP**) y, si hay otra carpeta, **Guardar y
  siguiente**. _KML con carpetas_ está en **Herramientas → Abrir y guardar**. En revisión manual: **Guardar y generar** y
  **Cancelar revisión**. «Atajos de teclado» abre la ayuda.
- **Avisos:** las sugerencias de invertir se reúnen en un solo recuadro («Atención · 2») con un botón por trazo; el
  aviso de revisión manual usa el mismo estilo.
- **Vacío / cargando / error:** el vacío dice qué hacer y ofrece el botón; la carga dice qué espera y cuánto suele
  tardar; el error dice qué pasó y cómo arreglarlo, sin disculpas.
- **Centro de control:** mismas reglas.
  - Cabecera: título, estado de conexión como etiqueta y un resumen («nada en ejecución · 0 en cola · en pausa»), con
    **Herramientas** y **Editor**. Pausar o reanudar la cola, procesar la siguiente, actualizar la fuente y encolar las
    pendientes de cada lote, nuevo chat y el glosario están en **Herramientas** (mismo cajón que el del editor).
  - Cada pestaña abre con una frase que dice para qué sirve.
  - _Cola_: una acción principal «Agregar a la cola»; las variantes (agregar como siguiente, procesar ahora) y las
    opciones avanzadas (sin red, sin IA) en el plegable «Más opciones». Cada ejecución en espera muestra **Iniciar** y un
    menú **⋯** (subir, bajar, poner al frente, quitar).
  - _Carpetas y archivos_: columna **Qué hacer** junto al estado; por mapa, la acción que toca ahora y el resto en el
    menú **⋯**. Por archivo, **Detalles** y **Abrir en el editor** a la vista y lo demás en **⋯**.
  - _Chat_: los ajustes (Qwen responde y razonamiento) en un panel **Ajustes**; quedan a la vista el selector de
    conversación, **Nuevo chat**, el campo de texto y las sugerencias.
  - _Consola_: filtros visibles y rotulados (componente, nivel, ruta, ejecución); seguir, pausar la vista, cargar
    anteriores y copiar en una barra.
- **Iconos:** SVG propio, trazo de 1.5 px, unos 20 en `src/ui/icons.tsx`. Sin dependencia nueva.

## 9. Distribución

- **Espaciado:** 4 · 8 · 12 · 16 · 24 px. **Panel:** se mantiene entre 380 y 560 px (3 de 10 partes). **Densidad:**
  media; fila de 44 px; el inspector respira más que la lista.
- **Rejilla:** dos columnas (mapa | panel) como hoy; el centro de control sigue cubriendo la ventana.
- **Quiebres:** desde 900 px dos columnas; por debajo, el panel pasa bajo el mapa (mapa al 45 % de alto).
- **Alineación:** texto a la izquierda; números y unidades alineados con su etiqueta.

## 10. Profundidad, movimiento e interacción

- **Elevación:** 3 niveles (panel, superficie, menús/ventanas). Sombra solo en menús y ventanas.
- **Movimiento:** solo responde a una acción —abrir o cerrar el cajón de Herramientas (150 ms, deslizamiento corto
  desde la derecha), plegar o abrir una sección (120 ms)—. Sin animaciones de entrada ni efectos al pasar el cursor en
  cada tarjeta. Cambiar de tema no se anima. Respeta `prefers-reduced-motion`.
- **Teclado:** foco visible en todo, Esc cierra menús y cajones, los atajos actuales no cambian. El cajón devuelve el
  foco al botón Herramientas al cerrarse.
- **Objetivo táctil:** unos 32 px de alto (herramienta de escritorio; no se optimizó para táctil).

## 11. Sí y no

**Sí**

- Un trazo seleccionado muestra lo esencial; lo demás espera en una sección plegada o en la herramienta que lo abre.
- Todo término propio se explica donde aparece.
- Los botones dicen qué pasa: «Guardar todo», «Invertir sentido», no «Aceptar».
- Una acción se llama igual en el botón, en el aviso y en el historial.

**No**

- No agrupar más de 6 controles en una tarjeta.
- No usar mayúsculas, interletrado ni numeraciones salvo en el paso a paso de la bienvenida (que sí es una secuencia).
- No usar color de estado como decoración ni degradados.
- No esconder una herramienta: si no aplica, se ve apagada con el motivo.

## 12. Implementación

- **Reorganización de `src/editor`** (con `git mv`, la lógica no se toca):

  ```
  src/editor/
    Editor.tsx            solo composición
    panel/                encabezado, navegación de carpetas, pie, avisos
    routes/               fila, inspector, herramienta activa, línea de recorrido
    organize/             árbol de carpetas, duplas, comparación de pares
    tools/                cajón Herramientas, registro de herramientas, atajos, glosario
    map/                  mapa, barra del mapa, capas, avisos sobre el mapa
    hooks/ state/ services/   sin cambios
  ```

- **Reorganización de `src/control`:** `chat/`, `queue/` (cola y ejecución), `files/`, `logs/` (consola e
  historial) y `details/`; `api.ts`, `state.ts` y `useCentro.ts` se quedan donde están. `tools.ts` decide el estado de
  las herramientas del centro (con pruebas), `ControlTools.tsx` las muestra y `glossary.ts` define sus términos.
- **Capa nueva `src/ui`:** cajón, fila y grupo de herramientas, lista de definiciones, panel flotante o menú,
  sección plegable, etiqueta con ayuda, iconos y el tema (`useTheme`, que guarda la preferencia). La usan editor y centro de control, que no pueden importarse entre sí; por eso se añade la
  capa en `tests/architecture/rules.ts` y en [architecture.md](architecture.md).
- **Estilos:** `src/styles.css` (1,723 líneas) se dividió en `src/styles/`: `tokens.css` (los dos temas, solo variables),
  `base`, `ui`, `editor` y `control`. Los colores fijos del centro de control se convirtieron a variables para que ambos
  temas funcionen; solo los marcadores sobre el mapa conservan colores fijos, porque se leen sobre calles y satélite.
- **Tema:** atributo `data-theme` en `<html>`, que se lee antes de pintar para evitar un destello; oscuro si no hay
  preferencia guardada.
- **Herramientas:** `state/tools.ts` decide, como función pura y con pruebas, si cada herramienta está disponible,
  recomendada o apagada y por qué; `tools/tools.tsx` le pone nombre, descripción, atajo e icono y alimenta el cajón. Es el
  único lugar donde se decide el estado de una herramienta.
- **Datos y textos:** definiciones del glosario tomadas de [editor.md](editor.md); se actualizan `editor.md` y
  `centro-de-control.md` donde cambien los nombres de botones.

## 13. Plan de evaluación

- **Base:** `npm run check` antes y después (tipos, lint, formato, build y pruebas).
- **Navegador:** abrir `tests/fixtures/ruta-1-sur-mapa-1.kml` y `ruta-2-sur-mapa-3.kml`; capturas antes y después de
  la bienvenida, carpeta abierta, trazo seleccionado, cajón Herramientas (con y sin trazo), editar, simplificar,
  ajustar a calles, guardar, y el centro de control con el servidor apagado y encendido. Todo en **ambos temas**.
- **Responsivo:** 1440 × 900, 1100 × 700 y 800 × 700.
- **Contraste y teclado:** medir los pares de las dos tablas de color y la letra de cada uno de los 8 colores de
  trazo; recorrer con Tab; Esc cierra el cajón y devuelve el foco; movimiento reducido. Buscar colores fijos que se
  hayan quedado fuera de las variables (el tema claro los delata).
- **Estados:** vacío, cargando, error, deshabilitado con motivo, revisión manual.
- **Mejor que el original:** controles simultáneos por tarjeta (de ~15 a ≤ 6), clics hasta cada herramienta (≤ 2) y
  que una persona sin contexto complete abrir → revisar → guardar.
- **Regresión genérica:** nada de degradados, tarjetas de relleno ni mayúsculas; el recorrido sigue siendo lo que
  destaca.

## 14. Resultado de la fase 1 (editor)

Medido con los dos KML de `tests/fixtures` cargados (10 trazos), en Chrome:

| Qué | Antes | Ahora |
| --- | --- | --- |
| Botones visibles a la vez en el panel | 67 | 36 |
| Campos visibles a la vez en el panel | 25 | 2 |
| Controles en el trazo seleccionado | unas 15 funciones en una tarjeta | 6 |
| Contraste de la letra de cada trazo | 1.98:1 a 3.96:1 | 5.1:1 a 10.2:1 |
| Contraste de los botones principales | 3.68:1 | 5.17:1 |
| Foco de teclado | el del navegador | anillo propio en todo control |
| Pruebas | 366 | 377 (9 de estados de herramientas, 2 de arquitectura) |

Verificado en el navegador, en ambos temas: bienvenida, lista con inspector, cajón de herramientas (disponible, apagada
con motivo y «Recomendado ahora» al invertir un trazo que va al revés), simplificar, arranque y cancelación del ajuste a
calles, editar con `E` y terminar con `Esc`, `Esc` en el cajón con el foco de vuelta en su botón, aviso «Atención»
y etiqueta «invertido», duplas y comparación plegadas, tema claro recordado, y anchos de 1440, 1100 y 800 px.

Pendiente o sin verificar:

- Fase 2 (centro de control): hecha, ver el apartado 15.
- No se probó con el ratón arrastrar una fila a otra carpeta, ni los guardados, ni la revisión manual de un mapa.
- El contraste de las dos tablas de color se calculó, pero no se midió pantalla por pantalla.
- La navegación completa con Tab y `prefers-reduced-motion` no se recorrieron a mano.

## 15. Resultado de la fase 2 (centro de control)

Medido en Chrome con el servidor del centro encendido y datos reales (lotes SUR y ORIENTE, 63 ejecuciones guardadas):

| Qué | Antes | Ahora |
| --- | --- | --- |
| Controles en la tarjeta de agregar a la cola | 11 (7 botones, 2 selectores, 2 casillas) | 4 (2 selectores, el botón principal y «Más opciones») |
| Botones por ejecución en la cola | 5 | 2 (Iniciar y el menú ⋯) |
| Acciones apiladas por mapa en Carpetas y archivos | hasta 4 | 1 a la vista y el resto en ⋯ |
| Controles en la cabecera del chat | 4 | 3 |
| Pruebas | 377 | 383 (6 de estados de herramientas del centro) |

Verificado en el navegador, en ambos temas: cola, en ejecución, carpetas y archivos (ruta que espera revisión, con su
acción principal y su menú ⋯), consola, historial, ventana de detalle de una ejecución, cajón de Herramientas con la cola en
pausa (ofrece «Reanudar» y deja apagado «Procesar la siguiente» porque no hay nada en la cola), glosario, y el panel de
ajustes del chat. Esc cierra los menús sin cerrar el centro.

También se corrigieron dos errores que ya existían: el elemento elegido en la lista de rutas de Carpetas y archivos se
leía casi invisible (texto oscuro sobre fondo oscuro), y la columna con las acciones de cada mapa quedaba fuera de la
pantalla.

Pendiente o sin verificar: no se pulsó ninguna acción que cambie el servidor (agregar a la cola, procesar, pausar), así que
el menú ⋯ de una ejecución en cola y el flujo de resolver conflictos solo se probaron por código y por pruebas; no se
verificó la vista angosta (la ventana de esta sesión no cambió de tamaño).

## 16. Barra de edición del trazo

Ajuste posterior a pedido de quien usa la herramienta: las tres herramientas de edición que más se usan no deberían exigir
abrir el cajón.

- **Qué es:** una barra sobre el mapa (`src/editor/map/EditBar.tsx`) con **Ajustar a calles**, **Editar vértices** y
  **Simplificar** a la vista, y un desplegable **Más** con invertir el sentido, deshacer, restaurar, ver en el mapa y la
  opacidad del trazo.
- **Una sola fuente de verdad:** usa las mismas herramientas del cajón (`buildTools`), con el mismo estado y la misma
  acción. Sin trazo seleccionado se ve apagada con el motivo; con una señal real, «Recomendado ahora» (p. ej. invertir).
- **Abrir y cerrar:** la herramienta abierta se marca (`aria-pressed`); pulsarla otra vez la cierra y abrir otra cierra la
  anterior. Lo mismo vale desde el cajón.
- **Dónde:** se eligió la barra sobre el mapa frente a una franja bajo el encabezado del panel o los botones dentro del
  inspector: no ocupa espacio del panel y no sube el inspector de 6 a 10 controles.
- **Espacio:** comparte fila con la barra del mapa base y baja a una segunda línea si no caben; con el mapa de 900 px o
  menos muestra sólo los iconos.

Verificado en Chrome (mapa de 549 px y de 996 px; tema oscuro y claro): abrir, cerrar y alternar las tres herramientas, el
desplegable con sus estados, y que no se solape con la barra del mapa base. El ajuste a calles solo se abrió y se cerró; no
se esperó su resultado.

## 17. Asistente de nombres

Pedido: al resolver a mano un mapa, los archivos con nombres como `5.-(3.-CIRCUNVALACION (COL. PABLO TORRES BURGOS)-TIERRA
LARGA Y 12 DE OCTUBRE (BASE TACAMBRO-…)` tardaban en nombrarse. Debían formularse con la colonia de inicio y la de final
(`R6O-12OCT-TLARG`, siglas de 5–6 letras como máximo), con ayuda de Qwen y comparando el nombre original con la propuesta.

- **Dónde:** botón **Sugerir nombre** bajo el campo *Nombre* del inspector (`NameAssistant`, en `src/editor/routes/`) y la
  misma herramienta en el cajón (`suggest-name`, grupo *Trazo seleccionado*). Sólo en modo revisión; fuera de él aparece
  apagada y lo dice. Se recomienda («Recomendado ahora») cuando el nombre actual no tiene la forma RUTA-ORIGEN-DESTINO.
- **Una card, no cuatro:** el asistente es un bloque que se abre y se cierra en el inspector (no una pantalla nueva), con
  tres partes en orden de lectura: estado de la IA y siglas editables → por cada trazo de la dupla, *de qué colonia a cuál*
  → los nombres que compiten (Original, Actual, Propuesta) con su puntaje («6 de 6») y, plegado, el detalle de cada criterio.
- **Comparación legible:** la cifra («1 de 6») y la frase «La propuesta se acerca más al nombre ideal (6 de 6 contra 1
  de 6)» responden la pregunta de cuál se acerca más al ideal; lo que falla se dice con palabras (`Lo que falla: …`) y el
  detalle de cada criterio está a un clic.
- **Qué hace Qwen y qué no:** sólo propone siglas de una colonia que no estaba en el catálogo. El nombre, la comparación y
  la validación son reglas (`src/core/naming.ts`, `src/orchestrator/llm/siglas.ts`), así que un resultado raro de Qwen se
  descarta y se ve en *Propuestas de Qwen descartadas*. Sin Qwen el asistente sigue funcionando con la regla de siglas y lo
  avisa en amarillo, sin culpar al usuario.
- **Accesible:** cada campo de siglas tiene etiqueta (`Siglas de Tierra Larga`), marca `aria-invalid` y dice el motivo
  en texto; el error de la petición usa `role="alert"`; los estados «En uso», «6 de 6» no dependen sólo del color.

Verificado en Chrome con el caso real del lote ORIENTE (RUTA 6A, trazo 5 de «Evaluar a mano»): sin Ollama (aviso y regla
de siglas), con Qwen real (`qwen3.5:4b` propuso `12DIC` en 8.1 s con el modelo en frío y pasó la validación), aplicar la
propuesta a un trazo y a la dupla (`R6AO-12DIC-FIMAD` / `R6AO-FIMAD-12DIC`), corregir siglas inválidas y válidas, abrirlo
desde el cajón y que cambiar de trazo lo cierre. No se pulsó *Guardar y generar*: nada se registró en el lote.
