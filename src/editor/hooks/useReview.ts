import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { SourceFile } from '../services/files';
import type { Route } from '../services/route';
import { evaluateMapRequest, nothingLeftMessage, resolveReviewsRequest, reviewDoneMessage, splitPending, type ReviewEditor } from '../state/review';
import type { Notify } from './useNotice';

/** Lo que el editor le pide al servidor del centro de control (lo inyecta quien monta el editor). */
export interface ReviewServer {
  evaluateMap: (request: ReturnType<typeof evaluateMapRequest>) => Promise<unknown>;
  resolveReviews: (request: ReturnType<typeof resolveReviewsRequest>) => Promise<unknown>;
}

interface Deps {
  reviewEditor: ReviewEditor | null;
  setReviewEditor: Dispatch<SetStateAction<ReviewEditor | null>>;
  routes: Route[];
  /** Dupla de cada trazo al evaluar a mano un mapa sin itinerarios. */
  reviewGroups: Map<string, number> | null;
  contentFor: (route: Route) => string;
  openFiles: (files: SourceFile[], selectIndex?: number, suggestedNames?: { indice: number; nombre: string }[]) => Promise<void>;
  setBusy: (busy: boolean) => void;
  setCenterOpen: (open: boolean) => void;
  notify: Notify;
  server: ReviewServer;
}

/** Resolver a mano en el editor los trazos que el orquestador dejó en revisión (o un mapa sin itinerarios). */
export function useReview({ reviewEditor, setReviewEditor, routes, reviewGroups, contentFor, openFiles, setBusy, setCenterOpen, notify, server }: Deps) {
  const openReview = useCallback(
    async (
      file: File,
      lote: string,
      traza: string,
      indice: number,
      nombres: { indice: number; nombre: string }[],
      totalTrazos: number,
      pendientes: { traza: string; indice: number; nombre?: string }[],
      mapa?: string,
    ) => {
      setReviewEditor({ lote, totalTrazos, pendientes, mapa });
      setCenterOpen(false);
      await openFiles([{ file, path: file.name }], indice, nombres);
      notify(
        mapa
          ? `Mapa sin itinerarios cargado (${file.name}): elimina lo que no sea itinerario, revisa las duplas y pulsa «Guardar y generar».`
          : `Original completo cargado (${file.name}). Se aplicaron los nombres sugeridos disponibles; organiza los trazos y pulsa «Guardar y generar».`,
      );
    },
    [setReviewEditor, setCenterOpen, openFiles, notify],
  );

  const saveReview = async () => {
    if (!reviewEditor || reviewEditor.pendientes.length === 0) {
      notify('Este mapa ya no tiene conflictos pendientes para generar.', 'error');
      return;
    }
    const split = splitPending(reviewEditor, routes);
    if (split.kept.length === 0) {
      notify(nothingLeftMessage(reviewEditor), 'error');
      return;
    }
    setBusy(true);
    try {
      if (reviewEditor.mapa) {
        await server.evaluateMap(evaluateMapRequest({ ...reviewEditor, mapa: reviewEditor.mapa }, split, reviewGroups!, contentFor));
      } else {
        await server.resolveReviews(resolveReviewsRequest(reviewEditor, split, contentFor));
      }
      setReviewEditor(null);
      setCenterOpen(true);
      notify(reviewDoneMessage(reviewEditor, split.kept.length, split.removed.length, new Set(reviewGroups?.values()).size));
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelReview = () => {
    setReviewEditor(null);
    setCenterOpen(true);
  };

  return { openReview, saveReview, cancelReview };
}
