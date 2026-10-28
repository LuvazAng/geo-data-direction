# geo-data-direction

Herramienta local para revisar y ordenar rutas de transporte publicadas como mapas KML/KMZ: fija el sentido
(INICIO → FINAL) de cada trayecto, detecta los pares ida/regreso y, para zonas completas, descarga los mapas,
los clasifica, les pone nombre y genera un reporte.

Todo corre en tu equipo. Tiene tres partes que se usan juntas o por separado:

- **Editor de trayectos**: app web para abrir KML/KMZ, ver el sentido en el mapa, comparar trayectos, invertirlos,
  editar su geometría y exportar los archivos ya ordenados. Guía: [docs/editor.md](docs/editor.md).
- **Orquestador**: programa de línea de comandos que lee un sitio de mapas, descarga los KML, decide origen, destino y
  sentido de cada trazo con evidencias (geometría, localidades del INEGI, nombres y, opcionalmente, un modelo de IA
  local) y escribe los resultados con su reporte. Guía: [docs/orquestador.md](docs/orquestador.md).
- **Centro de control**: servidor local y pantalla dentro de la app para manejar el orquestador (cola de ejecuciones,
  archivos, revisión de casos dudosos, consola en vivo y chat). Guía: [docs/centro-de-control.md](docs/centro-de-control.md).

## Inicio rápido

Necesitas Node.js 22 o superior y, para el editor, Chrome o Edge.

```bash
npm start
```

Instala las dependencias si faltan, levanta el centro de control y la app, y abre el navegador. `Ctrl+C` detiene todo.
La primera vez, si hay una terminal interactiva, hace tres preguntas opcionales (no se instala nada sin tu
confirmación):

1. **IA local**: instalar Ollama y descargar el modelo `qwen3.5:4b` (unos 3.3 GB). Sirve para resolver casos
   dudosos y conversar en el centro de control; el editor no la necesita.
2. **Colonias del INE**: descargarlas (16 MB) para dibujarlas en el mapa y agregarlas a los KML.
3. **Carpeta de datos** del orquestador (ver [data/README.md](data/README.md)); se guarda en `.env`.

Sin terminal interactiva no pregunta ni instala nada. Opciones: `npm start -- --sin-navegador`, `--sin-ollama`,
`--sin-asistente` y `--configurar` (repite las preguntas).

Si sólo quieres el editor: `npm run dev` (http://localhost:5199).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm start` | Todo junto, con el asistente de primer arranque |
| `npm run dev` | Sólo el editor |
| `npm run centro` | Sólo el servidor del centro de control |
| `npm run orquestar -- --config config/lotes/sur.json` | El orquestador sobre un lote (ver `--ayuda`) |
| `npm run colonias` | Descarga las colonias del INE y prepara el GeoJSON del editor |
| `npm test` | Pruebas |
| `npm run check` | Tipos, linter, formato, compilación y pruebas (lo que corre la integración continua) |
| `npm run lint` | Linter (Oxlint) |
| `npm run format` | Aplica el formato (Prettier) |

## Datos y configuración

El editor funciona sin datos externos. El orquestador necesita el Marco Geoestadístico del INEGI (y puede usar las
colonias del INE y rutas ya clasificadas). Dónde conseguirlos y dónde van: [data/README.md](data/README.md).
Las variables de entorno (`GEODATA_DIR`, `INEGI_DIR`, `OLLAMA_URL`…) se pueden poner en un archivo `.env`; el
ejemplo está en [.env.example](.env.example). Cada lote (zona) se describe en `config/lotes/*.json`.

## Estructura

```
src/
  core/          Dominio puro compartido: KML, geometría, comparación de trazos, colonias
  protocol/      Contrato entre el servidor y las pantallas: tipos y constantes
  editor/        App del editor de trayectos
  control/       Pantalla del centro de control
  orchestrator/  Node: dominio, lectura de fuentes, pipeline, IA local, servidor y CLI
tests/           Refleja src/; fixtures en tests/fixtures
config/lotes/    Un JSON por lote (fuente, nomenclatura, IA)
docs/            Guías y decisiones de arquitectura
data/            Aquí van los datos externos (no se versionan)
tools/           Arranque (npm start) y asistente de primer arranque
```

Las capas sólo pueden depender de las de abajo; una prueba lo verifica. Detalle en
[docs/architecture.md](docs/architecture.md).

## Contribuir y seguridad

[CONTRIBUTING.md](CONTRIBUTING.md) explica cómo preparar el entorno y qué se espera de un cambio.
Para reportar una vulnerabilidad, ver [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE).
