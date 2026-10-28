# Orquestador de rutas KML/KMZ

Descarga los mapas publicados en un sitio de rutas (por omisión, el de Movilidad Morelos), analiza sus trazos, decide
origen, destino y sentido con evidencias, y genera los `.kml` con nombre y carpeta, más un reporte. No reemplaza al
[editor](editor.md): lo usa para revisar lo que queda pendiente.

```bash
npm run orquestar -- --config config/lotes/sur.json            # todo SUR
npm run orquestar -- --config config/lotes/sur.json --rutas ruta-1-sur,ruta-2-sur
npm run orquestar -- --config config/lotes/sur.json --sin-red  # reprocesar sin descargar
npm run orquestar -- --ayuda                                   # todas las opciones
npm test                                                       # pruebas
```

El resultado queda en `<GEODATA_DIR>/RUTAS_ORQUESTADOR/<lote>/` (**nunca escribe en la carpeta de rutas ya
clasificadas**). Antes de empezar revisa que el Marco Geoestadístico del INEGI esté en disco; si falta, se detiene y
dice qué hacer (ver [data/README.md](../data/README.md)).

`--rutas` procesa sólo esas subpáginas (acepta el slug o una parte, p. ej. `--rutas 2`): todo el lote se clasifica como
contexto, para que los códigos y nombres no cambien, pero sólo se descargan, se consultan a la IA y se escriben los
archivos de esas rutas; los resultados de las demás no se tocan. Un candado (`<lote>/.lock`) impide que dos procesos
escriban el mismo lote a la vez.

Para manejarlo desde la app (chat, cola, archivos y consola en vivo): [Centro de control](centro-de-control.md).

## 1. Cómo funciona

El orquestador es código de Node (`src/orchestrator`) con una CLI; el centro de control lo usa como librería. No hay base
de datos: el estado vive en archivos JSON del lote. Importa directamente `src/core` (lectura y escritura de KML,
geometría, comparación de trazos), el mismo código que usa el editor.

| Etapa | Qué hace | Código |
| --- | --- | --- |
| Fuente | Página de zona → subpáginas → mapas de My Maps (título = encabezado anterior) o enlaces `.kml/.kmz` | `io/source.ts`, `io/http.ts` |
| Descarga | Exportación pública de My Maps (`/maps/d/kml?mid=…&forcekml=1`), valida y guarda el original + SHA-256 | `io/download.ts` |
| Análisis | Lee los trazos; tipo, extremos, longitud, anomalías, texto CP850 reparado | `domain/traces.ts` |
| Clasificación | Rol (principal, tramo, ampliación, base), duplas por vía, reasignación, sentido con evidencias | `domain/classify.ts` |
| Comparación | Índice de celdas + filtro por longitud/extremos → métricas detalladas sólo a pares plausibles | `domain/similarity.ts` |
| Casos etiquetados | Compara con las rutas ya clasificadas, aprende códigos por mayoría y valida las decisiones | `domain/labeled.ts` |
| IA | Sólo mapas con casos dudosos; sus propuestas se aceptan únicamente si la geometría las confirma | `llm/llm.ts` |
| Nombres y salida | Patrón + catálogos; escritura idempotente con manifiesto | `domain/naming.ts`, `io/output.ts` |
| Reporte | `reporte.md` y `reporte.json` del lote y de cada ejecución | `pipeline/report.ts` |

`pipeline/pipeline.ts` encadena las etapas (cada una vive en `pipeline/run/`) y `cli/cli.ts` es la entrada de línea de
comandos. Las reglas de qué capa puede importar a cuál están en [architecture.md](architecture.md).

### Estados

Por mapa en `estado.json`: `PENDIENTE → DESCARGANDO → DESCARGADO → ANALIZADO → GENERADO | REQUIERE_REVISION | ERROR`.
Por trazo en el reporte: `GENERADO`, `REQUIERE_REVISION` o `NO_SE_GENERA` (tramos, ampliaciones, bases, copias).
Si el proceso se corta, lo que quedó en `DESCARGANDO` vuelve a `PENDIENTE` y no se repite lo ya descargado.

## 2. Datos y dependencias

| Qué | Para qué |
| --- | --- |
| `src/core/kml.ts` | Leer KML/KMZ (varios trazos, carpetas, ExtendedData) y escribir (`buildKml`: aísla el trazo, conserva estilos y metadatos, INICIO/FINAL) |
| `src/core/analysis.ts` | `comparePair` (coberturas y sentido), `describedEnds`, `normalize`, `isCircuit` |
| `src/core/organize.ts` | `relate` (cómo se engancha una ampliación o tramo a su principal), `PRINCIPAL_RATIO` |
| `src/core/geometry.ts` | Proyección local en metros, muestreo, punto más cercano |
| INEGI, Marco Geoestadístico | Localidades (`17l`, `17lpr`) y municipios (`17mun`) para los extremos |
| INE, Base Geográfica Digital | Colonias por las que pasa cada trazo: campo `COLONIAS` del KML (`io/colonias.ts`, `src/core/colonias.ts`) |
| Rutas ya clasificadas (opcional) | Casos etiquetados, códigos existentes y números de ruta de otras zonas |
| Ollama + `qwen3.5:4b` (opcional) | Interpretación de casos dudosos |

Dependencias de desarrollo propias del orquestador: `jsdom` (DOMParser/XMLSerializer en Node para reutilizar `kml.ts` tal
cual y leer el HTML) y `tsx` (ejecutar la CLI en TypeScript); para extraer las colonias, `7zip-bin`. El lector de
shapefile/DBF y la proyección Lambert del INEGI se escribieron aquí (unas 150 líneas) para no agregar `shapefile` ni
`proj4`.

## 3. Configuración

`config/lotes/sur.json`. Las carpetas de datos no van en el archivo: salen de `GEODATA_DIR` (por omisión `./data`; ver
[data/README.md](../data/README.md)). Variables de entorno, también desde el archivo `.env` (ver `.env.example`):
`GEODATA_DIR`, `RUTAS_TRABAJO_DIR`, `RUTAS_EXISTENTES_DIR`, `INEGI_DIR`, `COLONIAS_DIR`, `RUTAS_FUENTE_URL`, `OLLAMA_URL`.
Un `dirs` en el archivo (rutas relativas a él) sólo hace falta para una carpeta que no esté en el lugar esperado, y la
variable de entorno manda sobre él.

```jsonc
{
  "lote": "SUR",
  "zona": "SUR",
  "fuente": {
    "url": "https://sites.google.com/view/movilidadmorelos/sur",
    "estrategia": "google-sites",            // o "enlaces-directos"
    "hosts": ["sites.google.com", "www.google.com"],
    "subpaginas": [],                        // filtro por slug; vacío = todas
    "mapas": [],                             // filtro por título
    "zonasReferencia": ["https://sites.google.com/view/movilidadmorelos/centro", "…/oriente"]
    // timeoutMs 30000, maxBytes 20 MB, reintentos 2, pausaMs 1000 (valores por omisión)
  }
}
```

Datos que el orquestador necesita (detalle en [data/README.md](../data/README.md)):

- **Marco Geoestadístico del INEGI** (obligatorio): si faltan sus capas, el orquestador se detiene al empezar —antes de
  crear carpetas o usar la red— y dice qué falta y cómo conseguirlo.
- **Colonias del INE** (opcional): con ellas, cada KML generado lleva en su ExtendedData `<Data name="COLONIAS">` las
  colonias por las que pasa, en orden de recorrido («COLONIA CENTRO, JOJUTLA; BARRIO SAN JUAN, JOJUTLA»; las que recorre
  menos de 50 m no se listan). Si la carpeta no existe se anota una advertencia; si existe pero no se puede leer, un error
  en el reporte. En ambos casos se genera sin el campo.
- **Rutas ya clasificadas** (opcional): si la carpeta no existe se anota una advertencia y se clasifica sin compararlas.

Como el contenido de los KML cambia al agregar las colonias, la primera corrida después de instalarlas actualiza los
resultados ya generados (los modificados a mano o aprobados manualmente no se tocan, como siempre).

Para otra zona basta copiar el archivo y cambiar `lote`, `zona` y `fuente.url`.

**Seguridad.** Sólo `https` y sólo los hosts listados (también en cada redirección); sin credenciales ni puertos raros;
tiempo de espera, tamaño máximo y reintentos limitados sólo para errores transitorios. Los KMZ se leen en memoria (no se
extraen a disco). Toda escritura pasa por `Workspace.path`, que rechaza rutas fuera del lote. Un 403 de My Maps se reporta
tal cual: no se intenta evadir.

## 4. Ejemplos

```bash
# sólo dos rutas, sin consultar a la IA
npm run orquestar -- --config config/lotes/sur.json --rutas ruta-1-sur,ruta-2-sur --sin-ia
# sólo los mapas cuyo título diga "TETELPA"
npm run orquestar -- --config config/lotes/sur.json --mapas TETELPA
# volver a descargar aunque ya estén los originales
npm run orquestar -- --config config/lotes/sur.json --refrescar
```

## 5. IA local (Ollama y Qwen)

Es opcional: sin ella el orquestador clasifica con reglas y deja los casos dudosos en revisión. El modelo por omisión es
`qwen3.5:4b` (unos 3.3 GB) servido por Ollama en `127.0.0.1:11434`; `npm start` ofrece instalarlos la primera vez.

El orquestador llama a Ollama **directamente** (`/api/chat` con `format` = JSON Schema, `think: false`, `temperature: 0`,
una petición a la vez, caché en `ia-cache.json`). Para una consulta acotada por mapa un agente es innecesario.

El modelo recibe un resumen (textos, lugares candidatos, localidades de cada extremo, similitudes ya calculadas), nunca
coordenadas ni credenciales, y no tiene herramientas. Su respuesta se valida (índices, nombres dentro de los candidatos,
vías presentes en el texto) y sólo se aplica si la geometría la confirma; la explicación siempre va al reporte. Si el
modelo no está, se informa y se sigue sin IA: **no se descarga ni se cambia de modelo por su cuenta**
(`ollama pull qwen3.5:4b` es decisión de quien usa la herramienta).

## 6. Nomenclatura

Patrón (`nomenclatura.patron`): `{ruta}-{origen}-{destino}{via}` → `R2S-JOJU-PZONDAXGAS`.
Carpeta: `<ZONA>/<RUTA-…>/<n>/` con una carpeta por dupla (ida + regreso) o por recorrido de tramos consecutivos, numeradas
en el orden de la página. Los tramos consecutivos comparten carpeta sólo si conectan por sus localidades y no tienen
variantes distintas; las ramas ambiguas y las variantes se conservan separadas.

- **Código de ruta**: `nomenclatura.rutas[slug].codigo` si está; si no, `R` + número (+ letra: 5A, 11B).
  Si el número ya existe en otra zona se agrega la letra de la zona: SUR = `S`, ORIENTE = `O` (`R4` → `R4S`).
  Si hay dos subpáginas con el mismo número en la zona, la segunda lleva letras del nombre (sugeridas, p. ej. `R1AHS`).
  Grupos sin número: `nomenclatura.rutasBase` (`INTERESCOLAR → INT_ESC`, `C T M → CTM`) o iniciales sugeridas.
- **Código de lugar**: configuración (`nomenclatura.localidades`) → aprendido de las rutas ya clasificadas por mayoría
  (`catalogo-aprendido.json`) → sugerido y marcado en el reporte (`codigoNuevo: "sugerir"`), o revisión
  (`codigoNuevo: "revision"`). Una letra de diferencia usa el mismo código (MONTAÑOS = MONTAÑO).
- **Vía** (`X LA GAS`, `(X FARMACIA)`, `(MERCADO)`…): con `incluirVia: "si-hay-varias"` se agrega sólo cuando la misma ruta
  tiene más de una dupla entre los mismos lugares; `"siempre"` la agrega siempre.
- **Repetidos**: `colision: "sufijo"` agrega `-2`, `-3`…; `"revision"` los manda a revisión.
- Sin origen o destino seguros **no se genera nombre**: el trazo queda en revisión con un nombre *propuesto*.
- **A mano en el editor**: al resolver un caso o evaluar un mapa, *Sugerir nombre* arma el mismo patrón con la colonia de
  inicio y la de final del trazo (INE) y compara el nombre original con la propuesta (6 criterios en `src/core/naming.ts`:
  forma, caracteres, código de ruta, siglas de 2 a 6, lugares y único). Las siglas salen del catálogo anterior, de Qwen
  (sólo propone y el servidor valida; «la IA no decide nombres») o de la regla (`abbreviatePlace`: `Tierra Larga → TLARG`,
  `12 de Octubre → 12OCT`). Ver [editor.md](editor.md#sugerir-nombre-al-resolver-un-mapa).

## 7. Reporte

`reporte.md` (para leer) y `reporte.json` (completo). Contiene: fuente, conteos, mapas inaccesibles, casos en revisión con
motivo y nombre propuesto, archivos generados por ruta (origen → destino, localidades INEGI de cada extremo, sentido y
puntaje, similitud de la dupla, método), validación contra las rutas ya clasificadas, códigos sugeridos y en conflicto,
posibles duplicados entre mapas, intervenciones de la IA, tramos/ampliaciones con su relación, archivos nuevos/sin
cambios/conflictos y tiempos por etapa.

```
| Dupla | Archivo        | Origen → Destino   | Inicio → Final (INEGI)         | Sentido         | Similitud dupla | Método
| 1     | R2S-JOJU-TETEL | JOJUTLA → TETELPA  | Jojutla → Zacatepec de Hidalgo | confirmado (+4) | 92 % parcial    | DESCRIPCIO + localidad + terminal
| 2     | R2S-TETEL-ZAC  | TETELPA → ZACATEPEC| Zacatepec → Zacatepec          | confirmado (+3) | 100 % casi-…    | DESCRIPCIO + existente
```

### Cómo se decide el sentido

El primer punto del archivo **no** se toma como origen. Se suman evidencias de que el archivo va de ORIGEN a DESTINO
(según DESCRIPCIO, el nombre del trazo, "Indicaciones de…" o el título):

| Evidencia | Peso |
| --- | --- |
| El inicio/final está dentro (o junto) de la localidad INEGI que se llama como el origen/destino | ±2 |
| El inicio/final está en la terminal de la ruta (grupo de extremos dominante, nombrado por INEGI) | ±2 |
| Municipio del extremo (sólo si los extremos están en municipios distintos) | ±1 |
| Archivo ya clasificado entre las rutas existentes (sólo si no hubo ninguna otra evidencia) | ±3 |

Sólo positivas → `confirmado`; sólo negativas → `contrario` (revisión: el trazo va al revés de su DESCRIPCIO; **no se
invierte**); ambas → `contradictorio`; ninguna → `sin-evidencia`. Una localidad que contiene a los dos extremos no cuenta.
Ida y regreso con la misma geometría en el mismo orden van a revisión.

### Cómo se calcula la similitud

Con tolerancia `toleranciaM` (25 m): cobertura A→B = % de puntos de A, muestreados cada ~25 m, que quedan a menos de la
tolerancia de B; similitud = promedio de ambas coberturas. Además: razón de longitudes, longitud compartida, distancia
media y p95 entre trazos, y sentido. Clases: `identico`, `identico-invertido`, `casi-identico[-invertido]` (ambas
coberturas ≥ 0.95 y longitudes ≥ 90 %), `contenido`, `parcial` (≥ 0.3), `distinto`. Umbrales en `config.similitud`. Sin
azar: mismo resultado siempre.

## 8. Pruebas

`npm test` (Vitest). Las del orquestador están en `tests/orchestrator/`:

| Qué cubren | Archivo |
| --- | --- |
| Enlaces directos, recursos irrelevantes, páginas con JavaScript | `io/source.test.ts` |
| Descarga fallida o incompleta, reintentos, límites, hosts | `io/http.test.ts` |
| KML/KMZ inválidos, interrupción y reanudación | `io/download.test.ts` |
| Trazos idénticos, invertidos, parciales; reproducibilidad | `domain/similarity.test.ts` |
| Ida/regreso con información insuficiente, localidades no identificables, casos etiquetados reales | `domain/classify.test.ts` |
| Respuestas inválidas de la IA o modelo ausente | `llm/llm.test.ts` |
| Nombres repetidos | `domain/names.test.ts`, `io/output.test.ts` |
| Reprocesar el mismo archivo, de principio a fin | `io/output.test.ts`, `pipeline/pipeline.test.ts` |
| Configuración, carpetas de datos y verificación previa | `config.test.ts`, `pipeline/preflight.test.ts` |
| Colonias del INE: lectura y descarga | `io/colonias.test.ts`, `io/ine.test.ts` |

Los casos reales usan copias de mapas y archivos clasificados en `tests/fixtures`, y un extracto del Marco Geoestadístico
(`tests/fixtures/inegi`, con su atribución), así que corren en cualquier copia del repositorio. Si tienes los datos
completos (ver [data/README.md](../data/README.md)) se agregan comprobaciones sobre ellos.

## 9. Uso típico

1. `npm install`
2. Datos del INEGI en su carpeta (ver [data/README.md](../data/README.md)); opcionalmente Ollama con `qwen3.5:4b` (o usar
   `--sin-ia`).
3. `npm run orquestar -- --config config/lotes/sur.json`
4. Abrir `<GEODATA_DIR>/RUTAS_ORQUESTADOR/SUR/reporte.md`.
5. Revisar `resultados/_REVISION/` en el editor (`npm run dev`, abrir carpeta) y fijar en la configuración los códigos
   sugeridos que se quieran conservar (`nomenclatura.localidades`, `vias`, `rutas`).
6. Volver a correr con `--sin-red`: sólo cambia lo que cambió la configuración.
7. Copiar a donde correspondan los resultados aprobados (el orquestador no lo hace).

## 10. Limitaciones y mejoras

- Los mapas de My Maps que no permiten exportar (403) quedan fuera; hace falta que el dueño habilite la descarga.
- Rutas urbanas con los dos extremos en la misma localidad dependen de la terminal; sin ella quedan en revisión. Mejora
  posible: puntos de interés de INEGI (`17sip`) u otra fuente de colonias como evidencia adicional.
- Los códigos sugeridos son mecánicos (`SGPAL` sí, `PZONDA` no): conviene fijarlos en la configuración.
- Variantes muy cortas ("X LA FARMACIA", 0.7 km) se reportan como tramo: la ruta completa por la farmacia se puede armar
  con «Crear ruta alterna» del editor (`buildAlternative`).
- La numeración de carpetas es por dupla; si un mapa tiene dos duplas, las carpetas siguientes se recorren respecto a las
  rutas ya clasificadas.
- No escribe en ninguna base de datos: la carga de los resultados a otro sistema es un paso aparte.
