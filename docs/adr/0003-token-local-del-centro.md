# 0003 · El centro de control exige un token local

**Estado:** aceptada.

## Contexto

El servidor del centro de control puede encolar y cancelar ejecuciones, escribir archivos en las carpetas de los lotes y
descargar de la red. La app web no tiene usuarios ni sesión. Aunque escuche sólo en el equipo, cualquier página abierta en
el navegador podría intentar hablarle (formularios de otro sitio, `fetch` a `127.0.0.1`, DNS rebinding).

## Decisión

- El servidor escucha **sólo en `127.0.0.1`**.
- Toda petición debe llevar un **token** (32 bytes aleatorios en hexadecimal) en la cabecera `x-centro-token`. El servidor lo
  crea la primera vez en `.centro/token` (permisos `0600` donde el sistema los soporta, y fuera del control de versiones) y
  lo compara en tiempo constante.
- El **proxy de Vite** (`/api`) agrega el token a cada petición: el navegador nunca lo ve ni lo necesita, así que ninguna
  página ajena puede obtenerlo. Si el servidor se reinicia con otro token, el proxy lo vuelve a leer.
- Se rechazan los `Host` que no sean los de la propia dirección local (DNS rebinding) y los `Origin` que no sean los de la
  app.
- Sólo se aceptan `POST` con `Content-Type: application/json` y cuerpo acotado: un formulario de otro sitio no puede
  enviarlos, y CORS no se habilita.
- Las acciones permitidas son una lista cerrada validada en el servidor (`src/orchestrator/server/actions.ts`) y los archivos
  se limitan a `originales/` y `resultados/` de los lotes configurados.

## Alternativas descartadas

- **Sin autenticación**, confiando en que sólo escucha en local: no protege de otras páginas del mismo navegador.
- **Usuario y contraseña o cookie de sesión**: complicación sin beneficio para una herramienta de un solo usuario en su
  propio equipo.
- **Un socket local o un canal sin red**: la app web necesita HTTP y SSE a través de Vite.

## Consecuencias

- El centro sólo se usa a través del proxy de Vite (`npm start` o `npm run dev`): llamar a la API con `curl` requiere leer el
  token de `.centro/token`.
- Exponer Vite en la red (`--host`) o el puerto del centro rompe estas garantías: hay que ponerlos detrás de un acceso
  autenticado. Ver [SECURITY.md](../../SECURITY.md).
