# Datos

El editor de trayectos funciona sin nada de esto. El **orquestador** (`npm run orquestar`) y el
**centro de control** necesitan datos geográficos que no se incluyen en el repositorio: pesan decenas de
megas y tienen su propia licencia. Esta carpeta es el lugar por omisión para ponerlos; su contenido está
ignorado por git (sólo se versiona este archivo).

Para guardarlos en otro lugar define `GEODATA_DIR` (ver [.env.example](../.env.example)).

## Qué va en cada carpeta

Dentro de `data/` (o de `GEODATA_DIR`):

| Carpeta | Contenido | Obligatoria | Se crea sola |
| --- | --- | --- | --- |
| `inegi/conjunto_de_datos/` | Marco Geoestadístico del INEGI: `17l`, `17lpr` y `17mun` (`.shp`, `.shx`, `.dbf`, `.prj`) | Sí | No |
| `INE_BGD_2025/17_morelos/` | Colonias del INE: `COLONIA.*` y `MUNICIPIO.*` | No | No |
| `RUTAS/` | Rutas ya clasificadas a mano, `<ZONA>/<RUTA>/<dupla>/<CÓDIGO>-<ORIGEN>-<DESTINO>.kml` | No | No |
| `RUTAS_ORQUESTADOR/` | Salida del orquestador: un lote por carpeta (estado, originales, resultados y reportes) | — | Sí |

### Marco Geoestadístico del INEGI (obligatorio para el orquestador)

Sirve para nombrar el inicio y el final de cada trazo con la localidad y el municipio donde caen.

1. Entra a <https://www.inegi.org.mx/temas/mg/>, sección de descargas, y baja el archivo de Morelos
   (`17_morelos.zip`).
2. Descomprímelo en `inegi/` de modo que queden los archivos en `inegi/conjunto_de_datos/17l.shp`
   (el `.zip` trae `catalogos/`, `conjunto_de_datos/` y `metadatos/`).

Sin estos archivos el orquestador se detiene al empezar y dice qué falta, antes de usar la red.

### Colonias del INE (opcional)

Con ellas cada KML generado lleva las colonias por las que pasa (campo `COLONIAS`) y el editor las
dibuja en el mapa. Sin ellas todo funciona: el orquestador lo anota como advertencia y el editor deja
desactivada la casilla «Todas las colonias» (con «Colonias no disponibles» y qué hacer).

```bash
npm run colonias
```

Descarga de la Base Geográfica Digital del INE (<https://cartografia.ine.mx/sige8/productosCartograficos/bases>,
corte de diciembre de 2025, Morelos, 16 MB) y deja `COLONIA.*` y `MUNICIPIO.*` en `INE_BGD_2025/17_morelos/`.
Después genera `public/datos/colonias-morelos.geojson`, el archivo que carga el editor (no se versiona).
Con `-- --actualizar` vuelve a descargar; con `-- --sin-descarga` sólo convierte lo que ya esté en la carpeta.
Si prefieres bajarlo a mano, descomprime el `.7z` y deja esas capas en la misma carpeta.

### Rutas ya clasificadas (opcional)

Si ya tienes KML clasificados a mano, el orquestador los compara con lo que genera, aprende de ellos los
códigos de los lugares y valida sus propias decisiones. Sin esta carpeta clasifica igual, sin esa ayuda.

## Si tus carpetas tienen otros nombres

No hace falta moverlas: apunta cada una con su variable (`INEGI_DIR`, `COLONIAS_DIR`,
`RUTAS_EXISTENTES_DIR`, `RUTAS_TRABAJO_DIR`) en el archivo `.env`. Una variable de entorno del sistema
manda sobre el archivo.
