import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OrqConfig } from '../../config';
import { MissingDataError } from '../../errors';
import { INEGI_CAPAS } from '../../io/inegi';

/** Antes de gastar red y tiempo: lo imprescindible para clasificar tiene que estar en disco. */
export function checkData(cfg: OrqConfig) {
  const faltan = INEGI_CAPAS.filter((capa) => !existsSync(join(cfg.dirs.inegi, `${capa}.shp`)));
  if (!faltan.length) return;
  throw new MissingDataError(
    `Falta el Marco Geoestadístico del INEGI (${faltan.map((c) => `${c}.shp`).join(', ')}) en ${cfg.dirs.inegi}.\n` +
      'Descarga el de Morelos (17_morelos.zip, https://www.inegi.org.mx/temas/mg/) y descomprímelo ahí, o indica dónde lo tienes ' +
      'con INEGI_DIR o GEODATA_DIR (archivo .env). Detalle en data/README.md.',
  );
}
