import { relative, sep } from 'node:path';
import { loadConfig } from '../config';
import { run } from '../pipeline/pipeline';
import type { JobRunner } from './jobs';

/**
 * Ejecuta una ejecución del centro con el mismo orquestador que usa la CLI (no hay otro motor).
 * La configuración del lote se vuelve a leer cada vez: los códigos que se fijen en el archivo
 * se aplican en la siguiente ejecución sin reiniciar el servidor.
 */
export const pipelineRunner: JobRunner = async (job, { signal, emit, lote }) => {
  const cfg = loadConfig(lote.archivo);
  if (job.parametros.sinIa) cfg.ia.habilitada = false;
  const r = await run(cfg, {
    scope: job.unidad.tipo === 'ruta' ? [job.unidad.slug] : undefined,
    soloFuente: job.unidad.tipo === 'fuente',
    sinRed: job.parametros.sinRed,
    refrescar: job.parametros.refrescar,
    reportDir: ['ejecuciones', job.id],
    owner: `centro de control (${job.id})`,
    emit,
    signal,
  });
  return {
    ...r.resumen,
    reporte: relative(lote.raiz, r.reportePath).split(sep).join('/'),
    tiempos: r.report.tiempos,
  };
};
