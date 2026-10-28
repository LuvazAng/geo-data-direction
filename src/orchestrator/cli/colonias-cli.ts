import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadColoniasIne } from '../io/colonias';
import { coloniasInstaladas, INE_BGD_PORTAL, instalarColonias } from '../io/ine';
import { dataDirs, loadEnv, PROJECT_DIR } from '../paths';

// Prepara las colonias del INE para el editor y el orquestador:
//   npm run colonias [-- --dir <carpeta de COLONIA.shp> --salida <archivo .geojson> --actualizar --sin-descarga]
// Si las capas no están en la carpeta (<GEODATA_DIR>/INE_BGD_2025/17_morelos) las descarga del INE (16 MB);
// con --actualizar las baja de nuevo. Después las convierte al GeoJSON que carga el editor.

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnv();
  const dir = resolve(arg('--dir') ?? dataDirs().colonias);
  const out = resolve(arg('--salida') ?? resolve(PROJECT_DIR, 'public/datos/colonias-morelos.geojson'));
  const descargar = process.argv.includes('--actualizar') || !coloniasInstaladas(dir);
  if (descargar) {
    if (process.argv.includes('--sin-descarga'))
      throw new Error(`No hay colonias en ${dir} y se pidió no descargarlas (--sin-descarga). Fuente: ${INE_BGD_PORTAL}`);
    await instalarColonias(dir, { log: (m) => console.log(m) });
  }
  const data = loadColoniasIne(dir);
  // una colonia por línea: el archivo se puede revisar y comparar entre versiones
  const text = `{"type":"FeatureCollection","fuente":${JSON.stringify(data.fuente)},"features":[\n${data.features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  const tipos = new Map<string, number>();
  for (const f of data.features) tipos.set(f.properties.tipo || '(sin tipo)', (tipos.get(f.properties.tipo || '(sin tipo)') ?? 0) + 1);
  const municipios = new Set(data.features.map((f) => f.properties.municipio));
  console.log(`${data.features.length} colonias de ${municipios.size} municipios → ${out} (${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)} MB)`);
  console.log(
    [...tipos]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}: ${n}`)
      .join(' · '),
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
