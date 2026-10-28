# 0001 · Las colonias salen de la Base Geográfica Digital del INE

**Estado:** aceptada.

## Contexto

Se quiere saber por qué colonias, barrios, fraccionamientos y pueblos pasa cada trayecto, para dibujarlos en el editor y
escribirlos en el KML (`<Data name="COLONIAS">`). Hace falta una capa de polígonos de colonias de Morelos, abierta y
descargable sin intervención manual.

Lo que se revisó:

- **Marco Geoestadístico del INEGI**: ya se usa para las localidades, pero no trae colonias.
- **INEGI, Directorio/Cartografía de asentamientos humanos**: incompleta por municipio y detrás de un captcha.
- **Códigos postales de SEPOMEX** (datos abiertos): sólo polígonos de código postal, no colonias, y el sitio bloquea las
  descargas automáticas.
- **OpenStreetMap**: cobertura desigual de colonias y límites.
- **Base Geográfica Digital (BGD) del INE**: capa `COLONIA` por entidad, con clasificación de tipo (colonia, barrio,
  fraccionamiento, pueblo…) y el municipio al que pertenece.

## Decisión

Se usa la BGD del INE, corte del 15 de diciembre de 2025, entidad 17 (Morelos): 1,932 polígonos en 36 municipios. Se
descarga con `npm run colonias`, que baja el `.7z` (16 MB), extrae sólo las capas `COLONIA` y `MUNICIPIO` con `7zip-bin`
(ni Node ni el `tar` de Windows abren `.7z`) y genera `public/datos/colonias-morelos.geojson` para el editor. El orquestador
lee el shapefile directamente. La URL del corte está fija en `src/orchestrator/io/ine.ts`.

El GeoJSON **no se versiona**: son 3.6 MB derivados de datos ajenos y se regeneran con un comando. Sin él, el editor funciona
y avisa que las colonias no están disponibles.

## Consecuencias

- Hay una dependencia de desarrollo más (`7zip-bin`) y una descarga de red que sólo ocurre cuando se pide.
- El corte queda fijo: actualizarlo es cambiar la URL y volver a correr el comando; los KML ya generados se actualizan en la
  siguiente corrida del orquestador.
- Los datos vienen en UTM zona 14N con el DBF en ISO-8859-1 (sin `.cpg`) y el de municipios en UTF-8: la lectura (proyección
  inversa a longitud/latitud, codificaciones) está escrita en `src/orchestrator/io/colonias.ts`, sin librerías de
  proyección.
- Una calle que es el límite entre dos colonias cuenta para las dos; las que el trazo apenas toca (< 50 m) no se listan.
