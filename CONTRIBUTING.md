# Contribuir

Gracias por querer mejorar el proyecto. Esta guía explica cómo preparar el entorno y qué se espera de un cambio.

## Preparar el entorno

Necesitas Node.js 22 o superior.

```bash
git clone https://github.com/LuvazAng/geo-data-direction.git
cd geo-data-direction
npm ci
npm run check
```

`npm run check` corre lo mismo que la integración continua: tipos, linter, formato, compilación y pruebas. Debe pasar en un clon
limpio sin ningún dato externo. Los datos del INEGI y del INE sólo hacen falta para usar el orquestador con zonas reales
(ver [data/README.md](data/README.md)); con ellos las pruebas agregan comprobaciones extra.

Para probar la app: `npm start` (todo junto) o `npm run dev` (sólo el editor).

## Cómo está organizado

El código está en capas con fronteras que una prueba verifica; antes de agregar un archivo lee
[docs/architecture.md](docs/architecture.md). En corto:

- `src/core` es lógica pura, compartida por el navegador y Node;
- `src/protocol` son los tipos del contrato entre servidor y pantallas;
- `src/editor` y `src/control` son las dos pantallas y no se conocen entre sí;
- `src/orchestrator` es todo lo de Node (lectura de fuentes, pipeline, servidor del centro y CLI).

Importa `@core` y `@protocol` por su alias, nunca por sus archivos internos.

## Antes de enviar un cambio

1. **Una cosa por cambio.** Un movimiento mecánico (mover archivos, renombrar) va separado de un cambio de comportamiento.
2. **Pruebas.** Un cambio de comportamiento lleva su prueba; un error corregido, la prueba que lo reproduce. No se omiten ni
   se debilitan pruebas para que pase. Los datos de prueba van en `tests/fixtures` y las pruebas no deben depender de
   datos externos ni de la red.
3. **Formato y linter.** `npm run format` aplica Prettier (comillas simples, líneas de hasta 160 columnas) y `npm run lint`
   corre Oxlint (corrección, reglas de hooks de React, imports duplicados). `npm run check` falla si algo no pasa. Una regla
   no se desactiva para esconder un problema: si de verdad es intencional, el aviso lleva el motivo.
4. **`npm run check` en verde**, y si tocaste la interfaz, revisada a mano en el navegador.
5. **Documentación** en el mismo cambio que cambia el comportamiento: las guías están en `docs/` y `data/`.

## Mensajes de commit

`tipo(ámbito): resumen en imperativo`, en español, con el ámbito opcional. Tipos que se usan: `feat`, `fix`, `refactor`,
`test`, `docs`, `style` (sólo formato), `build`, `ci`, `chore`. Si hace falta explicar el porqué, va en el cuerpo, no en el
resumen.

```
feat(colonias): npm run colonias descarga los datos del INE
fix(colonias): dar permiso de ejecución a 7za en Linux y macOS
```

## Estilo

- La documentación y los mensajes para quien usa la herramienta están en español. Los identificadores mezclan español e
  inglés; no hace falta renombrarlos.
- Los comentarios explican el porqué cuando no es evidente, no lo que hace la línea.
- Prefiere funciones puras para la lógica y deja lo que toca el disco, la red o el sistema en la capa que le corresponde
  (`src/orchestrator/io`, servicios del editor).

## Lo que no debe subirse

Datos geográficos descargados (`data/` y `public/datos/`), el archivo `.env`, el token del centro (`.centro/`) ni
credenciales. Todo eso ya está ignorado por git: si aparece en `git status`, algo anda mal.

## Reportar problemas

Para errores y mejoras, abre una *issue* con los pasos para reproducir, lo que esperabas y lo que pasó. Para
vulnerabilidades, sigue [SECURITY.md](SECURITY.md) en lugar de abrir una *issue* pública.
