import { baseName, safeFileName, type FileGroup } from '../services/files';
import type { Route } from '../services/route';

// Guardar y exportar: cuándo se descarga un ZIP, cómo se llama, y qué subcarpetas se crearon.

/** Sin acceso a la carpeta (archivos abiertos sueltos) no se puede escribir en disco: se descarga un ZIP. */
export const needsZip = (routes: Route[]) => routes.every((r) => !r.source.dir && !r.source.baseDir && (!r.source.handle || r.parsed.count > 1 || r.folder));

/** Un archivo por trazo, con la estructura de carpetas. */
export const zipEntries = (routes: Route[], contentFor: (r: Route) => string) =>
  routes.map((r) => ({
    path: [r.folder, `${safeFileName(r.outName)}.kml`].filter(Boolean).join('/'),
    content: contentFor(r),
  }));

/** Nombre base para el ZIP y el KML con carpetas: la carpeta abierta o, si no, el primer archivo. */
export const exportTitle = (group: FileGroup | undefined, routes: Route[]) =>
  safeFileName(group?.folder.split('/').pop() || baseName(routes[0]?.source.file.name ?? 'rutas'));

/** Subcarpetas que se crearon al guardar, a partir de los nombres de archivo resultantes. */
export const createdSubfolders = (fileNames: string[]) => [
  ...new Set(fileNames.filter((name) => name.includes('/')).map((name) => name.replace(/\/[^/]*$/, ''))),
];
