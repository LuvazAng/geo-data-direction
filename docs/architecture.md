# Arquitectura

Un solo paquete de Node organizado en capas. Cada capa sólo puede depender de las de abajo, y una prueba lo verifica
(`tests/architecture/`), así que la estructura no se desordena con el tiempo.

```
                 ┌───────────────────────────────┐
                 │  shell: src/App.tsx, main.tsx │  junta el editor y el centro de control
                 └──────────┬─────────┬──────────┘
                            │         │
                   ┌────────▼───┐ ┌───▼────────┐        ┌──────────────────────────────┐
                   │   editor   │ │  control   │        │  orchestrator (Node)          │
                   │ (navegador)│ │(navegador) │        │  base → io → domain → llm     │
                   └────────┬───┘ └───┬────────┘        │       → pipeline → server/cli │
                            │         │                 └───────────────┬───────────────┘
                            └────┬────┴─────────────────────────────────┘
                                 ▼
                          ┌─────────────┐
                          │  protocol   │  tipos y constantes del contrato servidor ↔ pantallas
                          └──────┬──────┘
                                 ▼
                          ┌─────────────┐
                          │    core     │  dominio puro: KML, geometría, comparación, colonias
                          └─────────────┘

      ui: piezas de interfaz sin lógica de trazos (iconos, cajón, tema…). Las usan editor, control y shell.
```

## Capas

| Capa | Carpeta | Qué contiene | Puede importar de |
| --- | --- | --- | --- |
| core | `src/core` | Leer y escribir KML/KMZ, geometría, comparación de trazos, organización de duplas, colonias, nombres de archivo (siglas y evaluación) | nada |
| protocol | `src/protocol` | Tipos y constantes que comparten el servidor y las pantallas (eventos, acciones, revisiones) | core |
| ui | `src/ui` | Piezas de interfaz compartidas por las dos pantallas, sin lógica de dominio: iconos, cajón, filas de herramientas, panel flotante o menú, sección plegable, término con ayuda, tema claro/oscuro | nada |
| editor | `src/editor` | App del editor de trayectos: `panel/`, `routes/`, `organize/`, `tools/`, `map/` (componentes), `hooks/`, `services/` y `state/` (reglas puras) | core, protocol, ui |
| control | `src/control` | Pantalla del centro de control: `chat/`, `queue/`, `files/`, `logs/`, `details/` y su estado | core, protocol, ui |
| shell | `src/App.tsx`, `src/main.tsx` | Composición de las dos pantallas | editor, control, core, protocol, ui |
| orchestrator | `src/orchestrator` | Todo lo que corre en Node: orquestador, servidor del centro y CLI | core, protocol |

Reglas que verifica `tests/architecture/architecture.test.ts` (a partir de `rules.ts`, que son funciones puras probadas
con ejemplos inventados):

- `core` no importa de ninguna otra capa ni de módulos de Node; `protocol` sólo de `core`.
- `editor` y `control` no se importan entre sí ni importan del orquestador; corren en el navegador y no usan `node:*`.
- `ui` no importa de ninguna otra capa; `editor` y `control` la comparten así sin importarse entre sí.
- `core`, `protocol` y `ui` se importan con su alias (`@core`, `@protocol`, `@ui`) y sólo por su API pública
  (`index.ts`), nunca por sus archivos internos.
- Dentro del orquestador, una carpeta sólo importa de las de abajo (o de sí misma):

```
base (config.ts, errors.ts, paths.ts)  <  io  <  domain  <  llm  <  pipeline  <  server  =  cli
```

`server` y `cli` están al mismo nivel y no se importan entre sí.

## El orquestador por dentro

| Carpeta | Responsabilidad |
| --- | --- |
| `io/` | Todo lo que toca el exterior: HTTP con política, fuente del sitio, descarga, estado del lote en disco, salida idempotente, INEGI, colonias del INE |
| `domain/` | Reglas puras: análisis de trazos, similitud, clasificación y sentido, nombres, casos etiquetados |
| `llm/` | Cliente de Ollama: peticiones validadas, caché y compuerta de una petición a la vez |
| `pipeline/` | `pipeline.ts` encadena las etapas (`run/`: una por archivo) y escribe el reporte; `reviews/` resuelve los casos dudosos |
| `server/` | Servidor del centro de control: cola, eventos SSE, chat, vigilancia de carpetas (ver [centro-de-control.md](centro-de-control.md)) |
| `cli/` | Entradas de línea de comandos: `orquestar` y `colonias` |

El flujo de una ejecución está descrito en [orquestador.md](orquestador.md). Cada etapa recibe un `RunContext`
(`pipeline/run/context.ts`) con la configuración, el espacio de trabajo, el emisor de eventos y la lista de advertencias y
errores, y devuelve lo que necesita la siguiente.

## Datos y configuración

Los datos externos (INEGI, colonias del INE, rutas ya clasificadas) no van en el repositorio. Las carpetas salen de
`GEODATA_DIR` o de variables por carpeta, con el archivo `.env` como comodidad (`src/orchestrator/paths.ts`); ver
[data/README.md](../data/README.md). Cada lote se describe en `config/lotes/*.json`; `src/orchestrator/config.ts` valida
y completa la configuración.

## Decisiones

Las decisiones con alternativas descartadas están en [adr/](adr/):

- [0001](adr/0001-colonias-del-ine.md): de dónde salen las colonias.
- [0002](adr/0002-ia-local-ollama-qwen.md): IA local con Ollama y Qwen.
- [0003](adr/0003-token-local-del-centro.md): el token local del centro de control.

Además, una decisión de estructura: **un solo paquete** y no un monorepo con workspaces. Con unas 17 mil líneas y un
solo mantenedor, cinco `package.json` y referencias entre proyectos de TypeScript añaden pasos a quien clone sin dar nada
a cambio; la frontera entre capas ya la hace cumplir la prueba de arquitectura. Si algún día una capa necesita
publicarse por separado, se puede promover de forma mecánica.

## Cómo agregar código

1. Decide la capa por lo que el código *necesita*, no por comodidad: si es lógica pura de trazos va en `core`; si es un
   tipo que cruza el servidor y la pantalla, en `protocol`; si toca el disco o la red, en `orchestrator/io`.
2. Importa `@core` y `@protocol` por su alias. Si necesitas algo que no exporta su `index.ts`, expórtalo ahí.
3. Corre `npm run check`: si rompiste una frontera, la prueba de arquitectura dice qué archivo importa qué.
4. Los archivos de más de unas 600 líneas suelen estar haciendo dos cosas: divídelos por responsabilidad.
