import type { Job } from '@protocol';
import type { Report } from '../pipeline/report';
import { describe } from './jobs';
import { sanitizeText } from './sanitize';

/** Resumen para Pi: cifras y motivos, sin coordenadas ni rutas del equipo. */
export function piPrompt(j: Job, report: Report | null): string {
  const lines = [
    `Ejecución ${j.id}: ${describe(j)}. Estado: ${j.estado}. Etapas: ${
      Object.entries(j.tiempos)
        .map(([k, v]) => `${k} ${Math.round((v ?? 0) / 100) / 10} s`)
        .join(', ') || '—'
    }.`,
    j.resultado
      ? `Mapas: ${j.resultado.mapas} (${j.resultado.mapasConError} con error). Trazos: ${j.resultado.trazos}. Archivos generados: ${j.resultado.generados}. En revisión: ${j.resultado.revision}.`
      : '',
    j.errores.length ? `Errores: ${j.errores.slice(0, 5).join(' | ')}` : '',
    j.advertencias.length ? `Advertencias: ${j.advertencias.slice(0, 5).join(' | ')}` : '',
  ];
  if (report) {
    const rev = report.trazos.filter((t) => t.estado === 'REQUIERE_REVISION').slice(0, 8);
    if (rev.length)
      lines.push(
        `Casos en revisión: ${rev.map((t) => `«${t.tituloMapa}» trazo ${t.indice} (${t.descripcion || t.nombreOriginal}): ${t.motivosRevision.join('; ')}`).join(' | ')}`,
      );
    const gen = report.trazos.filter((t) => t.estado === 'GENERADO').slice(0, 12);
    if (gen.length) lines.push(`Generados: ${gen.map((t) => `${t.nombreFinal} (${t.origen} → ${t.destino}, ${t.sentido})`).join(', ')}`);
    if (report.duplicados.length) lines.push(`Posibles duplicados con otras rutas: ${report.duplicados.length}.`);
    for (const i of report.ia.intervenciones.slice(0, 3)) lines.push(`Qwen sobre «${i.titulo}»: ${i.explicacion} ${i.cambios.join('; ')}`);
  }
  lines.push('Explica qué se hizo, qué quedó listo y qué necesita revisión humana.');
  return sanitizeText(lines.filter(Boolean).join('\n'), 5500);
}
