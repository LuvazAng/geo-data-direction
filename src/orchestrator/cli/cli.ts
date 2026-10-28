import '../io/dom';
import { ConfigError, loadConfig } from '../config';
import { MissingDataError } from '../errors';
import { loadEnv } from '../paths';
import { run } from '../pipeline/pipeline';
import { LockError } from '../io/store';

const HELP = `Orquestador de rutas KML/KMZ

Uso:
  npm run orquestar -- --config config/lotes/sur.json [opciones]

Opciones:
  --config <archivo>     configuración del lote (obligatorio)
  --rutas a,b,c          sólo estas subpáginas (slug o parte del slug), p. ej. ruta-1-sur
  --mapas a,b            sólo mapas cuyo título contenga estos textos
  --sin-red              no descargar: reprocesar los originales ya guardados
  --refrescar            volver a descargar aunque ya estén los originales
  --solo-descarga        detenerse después de descargar
  --sin-ia               no consultar a Qwen
  --ayuda                esta ayuda

Variables de entorno (también en el archivo .env, ver .env.example): GEODATA_DIR, RUTAS_TRABAJO_DIR,
RUTAS_EXISTENTES_DIR, INEGI_DIR, COLONIAS_DIR, RUTAS_FUENTE_URL, OLLAMA_URL`;

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new ConfigError(`Argumento inesperado: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

const list = (v: string | boolean | undefined) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.ayuda || args.help || typeof args.config !== 'string') {
    console.log(HELP);
    process.exit(args.ayuda || args.help ? 0 : 1);
  }
  const cfg = loadConfig(args.config);
  const mapas = list(args.mapas);
  if (mapas) cfg.fuente.mapas = mapas;
  if (args['sin-ia']) cfg.ia.habilitada = false;

  const result = await run(cfg, {
    sinRed: !!args['sin-red'],
    refrescar: !!args.refrescar,
    soloDescarga: !!args['solo-descarga'],
    scope: list(args.rutas),
    owner: `CLI (pid ${process.pid})`,
    log: (s) => console.log(s),
  });
  console.log(`\nReporte: ${result.reportePath}`);
}

main().catch((e) => {
  console.error(e instanceof ConfigError ? `Configuración inválida: ${e.message}` : e instanceof LockError || e instanceof MissingDataError ? e.message : e);
  process.exit(1);
});
