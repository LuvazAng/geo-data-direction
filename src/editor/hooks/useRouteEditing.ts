import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Organization, Relation } from '@core';
import type { Route } from '../services/route';
import { assignDuplaFolders, insideFolder, liftExtraFolders, liftFolderIn, renameFolderIn, swapFolder } from '../state/folders';
import { alternativeDraft, appendRoute, newRouteId, removedFrom, restoreRoutes, type PatchRoute } from '../state/routes';
import type { Notify } from './useNotice';

interface Deps {
  routes: Route[];
  setRoutes: Dispatch<SetStateAction<Route[]>>;
  patchRoute: PatchRoute;
  selectedId: string | null;
  select: (id: string | null) => void;
  fitTo: (ids: string[]) => void;
  byId: Record<string, Route>;
  org: Organization | null;
  relationFor: (shortId: string, mainId: string) => Relation | undefined;
  notify: Notify;
}

/** Cambios a la lista de trazos: carpetas, bajas (con «Deshacer») y rutas alternas. */
export function useRouteEditing({ routes, setRoutes, patchRoute, selectedId, select, fitTo, byId, org, relationFor, notify }: Deps) {
  /** Carpetas creadas a mano (aún sin trazos). */
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const resetFolders = useCallback(() => setExtraFolders([]), []);

  const createAlternative = useCallback(
    (shortId: string, mainId: string) => {
      const main = byId[mainId];
      const short = byId[shortId];
      const rel = relationFor(shortId, mainId);
      if (!main || !short || !rel) return;
      try {
        const draft = alternativeDraft(main, short, rel);
        const id = newRouteId();
        setRoutes((rs) => appendRoute(rs, draft, id));
        select(id);
        fitTo([id]);
        notify(`Ruta alterna creada: ${main.letter} + ${short.letter}`);
      } catch (e) {
        notify((e as Error).message, 'error');
      }
    },
    [byId, relationFor, setRoutes, select, fitTo, notify],
  );

  const moveToFolder = useCallback((id: string, folder: string) => patchRoute(id, { folder, saved: undefined }), [patchRoute]);

  const createFolder = useCallback((folder: string) => setExtraFolders((f) => (f.includes(folder) ? f : [...f, folder])), []);

  const renameFolder = useCallback(
    (from: string, to: string) => {
      setRoutes((rs) => renameFolderIn(rs, from, to));
      setExtraFolders((fs) => fs.map(swapFolder(from, to)));
    },
    [setRoutes],
  );

  /**
   * Quita trazos (y carpetas creadas a mano) de la lista; no borra archivos del disco, sólo
   * dejan de guardarse y exportarse. El aviso permite deshacerlo.
   */
  const removeRoutes = useCallback(
    (ids: string[], text: string, folders: string[] = []) => {
      const removed = removedFrom(routes, ids);
      setRoutes((rs) => rs.filter((r) => !ids.includes(r.id)));
      setExtraFolders((fs) => fs.filter((f) => !folders.includes(f)));
      if (selectedId && ids.includes(selectedId)) select(null);
      notify(text, 'ok', {
        label: 'Deshacer',
        run: () => {
          setRoutes((rs) => restoreRoutes(rs, removed, ids));
          setExtraFolders((fs) => [...fs, ...folders.filter((f) => !fs.includes(f))]);
        },
      });
    },
    [routes, setRoutes, selectedId, select, notify],
  );

  const removeRoute = useCallback(
    (id: string) => {
      const r = byId[id];
      if (r) removeRoutes([id], `Trazo ${r.letter} eliminado de la lista (el archivo en disco no se toca)`);
    },
    [byId, removeRoutes],
  );

  /** Elimina la carpeta. `withRoutes`: con sus trazos y subcarpetas; si no, éstos suben un nivel. */
  const deleteFolder = useCallback(
    (folder: string, withRoutes: boolean) => {
      const inside = insideFolder(folder);
      if (withRoutes) {
        const ids = routes.filter((r) => inside(r.folder)).map((r) => r.id);
        const extra = extraFolders.filter(inside);
        if (ids.length === 0) setExtraFolders((fs) => fs.filter((f) => !inside(f)));
        else removeRoutes(ids, `Carpeta «${folder.split('/').pop()}» eliminada con ${ids.length} trazo(s)`, extra);
        return;
      }
      setRoutes((rs) => liftFolderIn(rs, folder));
      setExtraFolders((fs) => liftExtraFolders(fs, folder));
    },
    [routes, extraFolders, setRoutes, removeRoutes],
  );

  /** Separa en carpetas 1, 2… : cada dupla con sus ampliaciones y alternas. */
  const assignFolders = useCallback(() => {
    if (!org) return;
    setRoutes((rs) => assignDuplaFolders(rs, org));
    notify('Trazos separados en carpetas por dupla; se aplican al guardar');
  }, [org, setRoutes, notify]);

  return { extraFolders, resetFolders, createAlternative, moveToFolder, createFolder, renameFolder, removeRoute, deleteFolder, assignFolders };
}
