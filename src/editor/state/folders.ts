import type { Organization } from '@core';
import type { Route } from '../services/route';

// Carpetas de los trazos: son rutas con «/» (p. ej. `1/ALTERNAS`). Funciones puras sobre las listas
// de trazos y de carpetas creadas a mano.

/** Renombra una carpeta y, con ella, sus subcarpetas. */
export const swapFolder = (from: string, to: string) => (f: string) => (f === from ? to : f.startsWith(from + '/') ? to + f.slice(from.length) : f);

export function renameFolderIn(rs: Route[], from: string, to: string): Route[] {
  const swap = swapFolder(from, to);
  return rs.map((r) => (swap(r.folder) === r.folder ? r : { ...r, folder: swap(r.folder), saved: undefined }));
}

/** ¿`f` es la carpeta o una de sus subcarpetas? */
export const insideFolder = (folder: string) => (f: string) => f === folder || f.startsWith(folder + '/');

/** Quita la carpeta sin sus trazos: éstos (y las subcarpetas) suben un nivel. */
export const liftFolder = (folder: string) => {
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  return (f: string) => (f === folder ? parent : f.startsWith(folder + '/') ? [parent, f.slice(folder.length + 1)].filter(Boolean).join('/') : f);
};

export function liftFolderIn(rs: Route[], folder: string): Route[] {
  const lift = liftFolder(folder);
  return rs.map((r) => (lift(r.folder) === r.folder ? r : { ...r, folder: lift(r.folder), saved: undefined }));
}

/** Las carpetas creadas a mano que quedan al quitar `folder` sin sus trazos. */
export const liftExtraFolders = (fs: string[], folder: string) => fs.filter((f) => f !== folder).map(liftFolder(folder));

/** Separa en carpetas 1, 2… : cada dupla con sus ampliaciones y alternas. */
export function assignDuplaFolders(rs: Route[], org: Organization): Route[] {
  return rs.map((r) => {
    const folder = r.alt ? org.folderOf[r.alt.mainId] : org.folderOf[r.id];
    return folder === undefined ? r : { ...r, folder, saved: undefined };
  });
}
