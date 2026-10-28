# Seguridad

## Cómo reportar una vulnerabilidad

No abras una *issue* pública. Usa el reporte privado de GitHub: en la pestaña **Security** del repositorio, **Report a
vulnerability**. Incluye qué versión o commit probaste, los pasos para reproducirlo y qué impacto tiene. Se responde lo
antes posible y se coordina la corrección antes de publicar los detalles.

Sólo se da soporte a la rama principal (`main`).

## Qué es esta herramienta, para entender su modelo de seguridad

Es una herramienta de **un solo usuario, en su propio equipo**. No hay cuentas, no hay base de datos y no está pensada para
exponerse en una red ni en internet.

## Centro de control (servidor local)

El servidor del centro de control puede encolar y cancelar ejecuciones, escribir archivos en las carpetas de los lotes y
descargar de la red. Cómo se protege (la decisión completa está en
[docs/adr/0003-token-local-del-centro.md](docs/adr/0003-token-local-del-centro.md)):

- Escucha **sólo en `127.0.0.1`**.
- Exige un **token local** en cada petición (`x-centro-token`). Se crea al primer arranque en `.centro/token`, no se versiona
  y el navegador nunca lo ve: lo agrega el proxy de Vite.
- Rechaza `Host` que no sean los de la propia dirección local (contra DNS rebinding) y `Origin` que no sean la app.
- Sólo acepta `POST` con `Content-Type: application/json` y cuerpo acotado; no habilita CORS.
- Las acciones que se pueden pedir (por la API, por los botones o desde el chat) son una lista cerrada que el servidor valida;
  lo que escribe el modelo de IA nunca se ejecuta.
- Los archivos que se pueden leer están limitados a `originales/` y `resultados/` de los lotes configurados, con la ruta
  validada.
- Los registros y el chat pasan por una sanitización que quita tokens, claves, credenciales en URLs y la carpeta personal.

Lo que **no** cubre: si expones Vite (`--host`) o el puerto del centro en una red, o si alguien con acceso a tu cuenta del
sistema lee `.centro/token`, esas garantías no se sostienen. En ese caso ponlo detrás de un acceso autenticado.

## Orquestador

- Sólo se conecta por `https` y sólo a los hosts de `fuente.hosts` (también en cada redirección), con tiempo de espera,
  tamaño máximo y reintentos limitados. Un acceso denegado (403) se reporta tal cual; no se intenta evadir.
- Los KMZ se leen en memoria (no se extraen a disco) y toda escritura pasa por una función que rechaza rutas fuera del lote.
- La IA es local (Ollama en el mismo equipo): la configuración rechaza una URL que no sea local, el modelo no recibe
  coordenadas ni credenciales y no tiene herramientas.
- `npm run colonias` descarga un archivo del INE y lo abre con `7za`; comprueba que sea un `.7z` y que traiga las capas
  esperadas, y extrae sólo esas.

## Datos que salen del equipo

El editor consulta servicios públicos con las coordenadas que estás viendo: teselas de mapa de OpenStreetMap y Esri,
Nominatim (calle y colonia de los extremos) y Overpass (calles de un solo sentido y ajuste a calles). El orquestador consulta
las páginas de la fuente configurada. Si trabajas con rutas que no deben salir del equipo, no uses esas funciones del editor
(o ponlas detrás de tu propia instancia de los servicios).

## Datos de entrada

Los archivos KML/KMZ se tratan como datos no confiables: se leen con un analizador de XML, no se ejecutan, y lo que se
muestra de ellos se escapa. Si encuentras un archivo que haga fallar al editor o al orquestador de una forma que no sea un
simple error de lectura, repórtalo.
