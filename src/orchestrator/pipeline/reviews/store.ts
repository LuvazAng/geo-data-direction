import { type Report, renderMarkdown } from '../report';
import { Workspace, type BatchState } from '../../io/store';
import type { LoteInfo } from '../../config';
import type { MapDecision, ReviewManifestEntry, ReviewResolution } from '@protocol';

// Lo que se guarda en disco de las revisiones (manifiesto de resultados y decisiones del usuario).

export interface Manifest {
  version: 1;
  archivos: Record<string, ReviewManifestEntry>;
}

export interface ReviewStore {
  version: 1;
  decisiones: Record<string, ReviewResolution>;
  mapas?: Record<string, MapDecision>;
}

const emptyManifest = (): Manifest => ({ version: 1, archivos: {} });

const emptyReviews = (): ReviewStore => ({ version: 1, decisiones: {} });

export function load(lote: LoteInfo) {
  const ws = new Workspace(lote.config.dirs.trabajo, lote.config.lote);
  const manifest = ws.readJson<Manifest>(['resultados', 'manifiesto.json'], emptyManifest());
  const report = ws.readJson<Report | null>(['reporte.json'], null);
  const reviews = ws.readJson<ReviewStore>(['revisiones.json'], emptyReviews());
  const state = ws.readJson<BatchState | null>(['estado.json'], null);
  return { ws, manifest, report, reviews, state };
}

export function persist(ws: Workspace, manifest: Manifest, reviews: ReviewStore, report: Report) {
  ws.writeJson(['resultados', 'manifiesto.json'], manifest);
  ws.writeJson(['revisiones.json'], reviews);
  ws.writeJson(['reporte.json'], report);
  ws.write(['reporte.md'], renderMarkdown(report));
}
