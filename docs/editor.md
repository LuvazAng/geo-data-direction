# Editor de trayectos

Herramienta web local para fijar el sentido (INICIO → FINAL) de los trayectos KML/KMZ y detectar pares
ida/regreso. Se abre con `npm run dev` (o con `npm start`, que levanta también el centro de control). Usa
Chrome o Edge. Para las otras partes del proyecto ver el [README](../README.md).

## Casos dudosos del orquestador

Los casos dudosos se resuelven desde **Carpetas y archivos**: en el archivo marcado como
`revision`, pulsa **Resolver conflictos** para abrirlo en el mapa, ajusta la geometría y pulsa
**Guardar y generar**. El resultado se registra como generado en el lote. Desde esa misma vista
se carga el KMZ/KML original completo (con todos sus trazos), puedes organizar las duplas,
ampliaciones y carpetas. Los nombres se precargan con las propuestas del orquestador (por ejemplo,
`R1O-TBUR-YECA` y `R1O-YECA-TBUR`) y puedes corregirlos antes de generar el mapa organizado.
Al guardar, cada conflicto pendiente se marca como resuelto y se genera en su propio KML, sin unir
las rutas entre sí. También puedes descartar un caso o varios, y deshacer una resolución.

## Flujo

1. **Arrastra la carpeta** con tus rutas (o usa *Abrir carpeta*). Cada subcarpeta
   (p. ej. `CENTRO/RUTA-1/1`) se trata como un par ida/vuelta y se recorre con
   `N` / `P`. La herramienta retoma en la primera carpeta pendiente.
   También puedes arrastrar KML/KMZ sueltos.
2. Para cada trayecto se muestra:
   - flechas de sentido en el mapa y marcadores **INICIO** (verde) / **FINAL** (rojo);
   - calle, colonia y municipio de ambos extremos (Nominatim / OSM, con caché local);
   - si el sentido coincide con `DESCRIPCIO` (p. ej. `JOJUTLA-PUENTE DE IXTLA`);
   - si el archivo ya traía INICIO/FINAL; en ese caso el trazo se orienta según ellos;
   - **si respeta las calles de un solo sentido** de OpenStreetMap (`oneway=*`, glorietas):
     metros a favor / en contra y las calles en contraflujo (rojo punteado en el mapa).
     Se ignoran vías de dos cuerpos y calles con `oneway:psv=no` / `oneway:bus=no`.
     La primera consulta de una zona a Overpass puede tardar 30–120 s; después queda en
     caché durante la sesión (el regreso del par sale al instante).
3. **Comparación**: con dos o más trayectos se calcula el % de coincidencia
   (puntos a ≤ *tolerancia* metros del otro trazo) y si van en sentidos **opuestos**
   (ida/vuelta ✓) o en el **mismo** sentido (⚠ hay que invertir uno).
4. `R` invierte el trayecto seleccionado. `Ctrl+S` guarda todo,
   `Ctrl+Shift+S` guarda y pasa a la siguiente carpeta.

## Colonias por las que pasa

Con un trazo seleccionado, el mapa pinta (del color del trazo y con su nombre) las colonias, barrios,
fraccionamientos, pueblos… por los que pasa, y la tarjeta las lista en orden de recorrido con su tipo,
municipio y metros recorridos. *Todas las colonias* (barra del mapa) muestra las demás de fondo.
Al guardar o generar, la lista se escribe en el KML como `<Data name="COLONIAS">`.

- Fuente: INE, Base Geográfica Digital (corte 15-dic-2025): 1,932 colonias de los 36 municipios.
  El Marco Geoestadístico del INEGI no trae colonias.
- `npm run colonias` las descarga del INE (16 MB) y genera `public/datos/colonias-morelos.geojson`, que es
  lo que carga la app (no se versiona; sin él la casilla «Todas las colonias» queda desactivada). Detalle en
  [data/README.md](../data/README.md).
- Una calle que es el límite entre dos colonias cuenta para las dos; las que el trazo apenas toca
  (< 50 m) no se listan, y las que tienen el mismo nombre y tipo en un municipio se listan una vez.

## Archivos con varios trazos, carpetas y rutas alternas

Un KML/KMZ puede traer varios trazos (p. ej. `RUTA_1` con ida, regreso y ampliaciones):
**se cargan todos**, cada uno con su nombre, DESCRIPCIO y AUTO-AMPL. Si dos trazos se llaman
igual, el nombre de salida se distingue con su DESCRIPCIO.

**Carpetas y trazos** (panel derecho, como el "Contenido del mapa" de Google Earth):

- Arranca con las carpetas que trae el KML. `+ Carpeta` crea una (usa `/` para subcarpetas,
  p. ej. `1/ALTERNAS`); doble clic o ✎ renombra.
- ✕ en una carpeta con trazos pregunta: *Sólo la carpeta* (sus trazos y subcarpetas suben un
  nivel) o *Carpeta y trazos* (se quitan junto con ella). Una carpeta vacía se quita directo.
- ✕ en una tarjeta (o `Supr` con el trazo seleccionado) quita ese trazo.
- Quitar trazos **no borra archivos del disco**: sólo dejan de guardarse y exportarse. El aviso
  ofrece *Deshacer* durante 10 s (`Ctrl+Z` también, si no hay trazo seleccionado).
- Arrastra una tarjeta a otra carpeta, o elígela en el selector *Carpeta* de la tarjeta.
- **Opacidad**: el control de la barra del mapa cambia la de todos los trazos y el de cada
  tarjeta la de ese trazo (se multiplican). Es sólo visual: no se escribe en el KML.
- **Separar en carpetas por dupla** acomoda cada dupla con sus ampliaciones y alternas en `1`, `2`…

Reglas fijas para clasificar (`src/core/organize.ts`):

- Los trazos se ordenan de mayor a menor longitud (A = el más largo).
- **Principal**: mide ≥ 50 % del más largo. El resto son **tramos cortos** (p. ej. `AMPL. …`).
- **Duplas**: los principales se emparejan por mayor coincidencia (≥ 40 %), sin importar el
  sentido; luego se indica si son ida/regreso ✓ o si van en el mismo sentido ⚠.
- Cada tramo corto se relaciona con cada principal según dónde se engancha (extremo a ≤ 150 m):
  variante (sale y se reincorpora), lazo, extensión al inicio/final, ramal de salida/entrada,
  "va encima" o sin relación. Se recomienda la principal que no obliga a invertir el tramo y
  queda más cerca.
- Se indica el **vértice de la principal** donde sale y donde se reincorpora (si el enganche
  queda a ≤ 30 m de un vértice, se corta justo ahí). Al seleccionar el tramo, ambos puntos se
  marcan en el mapa. Puedes cambiar la principal y los vértices a mano.
- **Crear ruta alterna** arma la ruta completa: principal hasta el vértice de salida → tramo →
  principal desde el vértice de reincorporación. Se guarda como `<principal> ALT <tramo>.kml`.

**Exportar**:

| Botón | Resultado |
| --- | --- |
| *Guardar todo* (carpeta abierta) | `<carpeta del archivo>/<carpeta>/<nombre>.kml`, un archivo por trazo |
| *Descargar ZIP* (archivos sueltos) | el mismo árbol de carpetas dentro de un ZIP |
| *KML con carpetas* | un solo KML con todas las carpetas, para revisarlo en Google Earth |

## Geometría

- **Simplificar** (Douglas-Peucker en metros): elige la desviación máxima permitida y ve cuántos
  puntos quedan antes de aplicar. Siempre conserva el primer y último punto.
- **Editar vértices** (`E`): arrastra un vértice para moverlo, arrastra un punto medio para
  agregar uno, clic derecho para quitarlo. `Ctrl+Z` deshace, *Restaurar* vuelve al archivo.
- **Ajustar a calles**: mueve el trazo sobre las calles de OpenStreetMap (`src/editor/services/snap.ts`).
  - *Margen*: qué tan lejos de una calle puede estar el trazo para ajustarlo (5–60 m, 25 m por
    defecto). Lo que quede más lejos se conserva tal cual (rosa punteado en el mapa).
  - Antes de aplicar se ve el resultado en blanco: % del trazo sobre calles, cuánto se movió
    y la longitud antes / después. Si la longitud cambia mucho, revisa: puede haberse ido por otra calle.
  - Sigue la red de calles (no salta a calles paralelas, las esquinas recortadas siguen la calle)
    e **ignora el sentido de las calles**: un trazo invertido se ajusta igual y el contraflujo se
    sigue revisando aparte. Se quitan los picos de ida y vuelta, salvo las vueltas en U que
    también hace el trazo original.
  - La primera descarga de calles de una zona puede tardar 30–120 s (Overpass); el regreso del
    par y las rutas vecinas reutilizan la caché. `Esc` cancela, `Ctrl+Z` deshace.

## Qué escribe

Se conserva el KML original (estilos, ExtendedData, descripción). Sólo:

- invierte las coordenadas del LineString si se pidió;
- elimina los Placemark `INICIO/START/ORIGEN` y `FINAL/FIN/END/DESTINO` anteriores;
- agrega `INICIO` y `FINAL` sobre los extremos del trazo, con la dirección en `<description>`;
- escribe (o reemplaza) `COLONIAS` en el ExtendedData del trazo.

| Origen | Al guardar |
| --- | --- |
| `.kml` de un solo trazo | se sobrescribe; si cambiaste nombre o carpeta, se mueve |
| `.kmz`, o archivo con varios trazos | se crea un `.kml` por trazo; el original se conserva |
| Ruta alterna | se crea su `.kml` nuevo |
| *Abrir archivos* (sin acceso a disco) | *Guardar como…* de la tarjeta: eliges carpeta y nombre (luego *Guardar* sobrescribe ese archivo); *Descargar ZIP* descarga todo |
