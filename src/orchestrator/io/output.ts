import { renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256, type Workspace } from './store';

// Escritura de resultados en <lote>/resultados con un manifiesto (huella de cada archivo):
//  - contenido idéntico al existente   → no se toca (idempotente)
//  - existe, lo generó el orquestador y nadie lo modificó → se actualiza
//  - existe y fue modificado a mano (huella distinta)      → NO se sobrescribe: conflicto en el reporte
//  - estaba en el manifiesto y ya no se genera             → se mueve a resultados/_obsoletos/<fecha>/ (no se borra)

export interface OutputEntry {
  /** Ruta relativa dentro de resultados/ (con /). */
  rel: string;
  kml: string;
  tipo: 'resultado' | 'revision';
  traza: string;
  mapa: string;
  fuente: string;
  original: string;
}

interface ManifestEntry {
  sha256: string;
  tipo: OutputEntry['tipo'];
  traza: string;
  mapa: string;
  fuente: string;
  original: string;
  generadoEn: string;
  resolucionManual?: { tipo: 'propia' | 'ampliacion' | 'alternativa'; nombre: string; nota: string; resueltoEn: string };
}

interface Manifest {
  version: 1;
  archivos: Record<string, ManifestEntry>;
}

export interface OutputSummary {
  escritos: string[];
  actualizados: string[];
  sinCambios: string[];
  conflictos: { rel: string; motivo: string }[];
  obsoletos: string[];
}

/**
 * @param scope en una ejecución parcial (sólo algunas rutas), los mapas que abarca: lo que está
 *   en el manifiesto y es de otros mapas no se toca ni se considera obsoleto.
 */
export function writeOutputs(ws: Workspace, entries: OutputEntry[], now = new Date(), scope?: Set<string>): OutputSummary {
  const manifest = ws.readJson<Manifest>(['resultados', 'manifiesto.json'], { version: 1, archivos: {} });
  const out: OutputSummary = { escritos: [], actualizados: [], sinCambios: [], conflictos: [], obsoletos: [] };
  const parts = (rel: string) => ['resultados', ...rel.split('/')];
  const meta = (e: OutputEntry, sha: string): ManifestEntry => ({
    sha256: sha,
    tipo: e.tipo,
    traza: e.traza,
    mapa: e.mapa,
    fuente: e.fuente,
    original: e.original,
    generadoEn: now.toISOString(),
  });
  const savedMeta = (e: OutputEntry, sha: string): ManifestEntry => {
    const value = meta(e, sha);
    const resolucionManual = manifest.archivos[e.rel]?.resolucionManual;
    return resolucionManual ? { ...value, resolucionManual } : value;
  };

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.rel)) {
      out.conflictos.push({ rel: e.rel, motivo: 'dos trazos generaron la misma ruta de archivo' });
      continue;
    }
    seen.add(e.rel);
    const sha = sha256(e.kml);
    if (ws.exists(...parts(e.rel))) {
      const current = sha256(ws.read(...parts(e.rel)));
      if (current === sha) {
        out.sinCambios.push(e.rel);
        manifest.archivos[e.rel] ??= meta(e, sha);
        continue;
      }
      if (manifest.archivos[e.rel]?.resolucionManual) {
        out.conflictos.push({ rel: e.rel, motivo: 'el archivo fue aprobado manualmente; no se sobrescribió' });
        continue;
      }
      if (manifest.archivos[e.rel]?.sha256 !== current) {
        out.conflictos.push({ rel: e.rel, motivo: 'el archivo existente fue modificado fuera del orquestador; no se sobrescribió' });
        continue;
      }
      ws.write(parts(e.rel), e.kml);
      manifest.archivos[e.rel] = savedMeta(e, sha);
      out.actualizados.push(e.rel);
      continue;
    }
    ws.write(parts(e.rel), e.kml);
    manifest.archivos[e.rel] = savedMeta(e, sha);
    out.escritos.push(e.rel);
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  for (const [rel, m] of Object.entries(manifest.archivos)) {
    if (m.resolucionManual) continue;
    if (seen.has(rel) || (scope && !scope.has(m.mapa))) continue;
    if (!ws.exists(...parts(rel))) {
      delete manifest.archivos[rel];
      continue;
    }
    if (sha256(ws.read(...parts(rel))) !== m.sha256) {
      out.conflictos.push({ rel, motivo: 'ya no se genera, pero fue modificado a mano: se dejó en su lugar' });
      continue;
    }
    const target = ws.path('resultados', '_obsoletos', stamp, ...rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    renameSync(ws.path(...parts(rel)), target);
    delete manifest.archivos[rel];
    out.obsoletos.push(rel);
  }

  ws.writeJson(['resultados', 'manifiesto.json'], manifest);
  return out;
}
