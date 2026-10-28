import JSZip from 'jszip';

// Ayudantes para la File System Access API (Chrome / Edge). Permiten guardar
// directamente sobre el archivo original sin pasar por "Descargas".

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    showSaveFilePicker?: (opts?: {
      suggestedName?: string;
      /** El navegador recuerda la última carpeta usada con este id. */
      id?: string;
      startIn?: FileSystemHandle;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
  interface DataTransferItem {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  }
  interface FileSystemHandle {
    queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  }
}

export interface SourceFile {
  file: File;
  /** Ruta relativa a la carpeta abierta (o sólo el nombre si se soltó suelto). */
  path: string;
  handle?: FileSystemFileHandle;
  dir?: FileSystemDirectoryHandle;
  /**
   * Archivo que no se debe sobrescribir ni borrar: una ruta alterna generada, o un archivo
   * con varios trazos (cada trazo se guarda en su propio .kml y el original se conserva).
   */
  isNew?: boolean;
  /** Carpeta respecto a la cual se interpreta la carpeta del trazo (la del archivo original). */
  baseDir?: FileSystemDirectoryHandle;
  basePath?: string;
}

export interface FileGroup {
  /** Carpeta relativa, p. ej. "CENTRO/RUTA-1/1". */
  folder: string;
  files: SourceFile[];
}

export const isRouteFile = (name: string) => /\.(kml|kmz)$/i.test(name);
export const baseName = (name: string) => name.replace(/\.(kml|kmz)$/i, '');

export const supportsFsAccess = () => typeof window.showDirectoryPicker === 'function';
export const supportsSaveAs = () => typeof window.showSaveFilePicker === 'function';

/** Recorre una carpeta y agrupa los KML/KMZ por subcarpeta (cada subcarpeta = un par ida/vuelta). */
export async function scanDirectory(root: FileSystemDirectoryHandle): Promise<FileGroup[]> {
  const groups = new Map<string, SourceFile[]>();
  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (isRouteFile(entry.name)) {
        const handle = entry as FileSystemFileHandle;
        const list = groups.get(prefix) ?? [];
        list.push({ file: await handle.getFile(), path: prefix ? `${prefix}/${entry.name}` : entry.name, handle, dir });
        groups.set(prefix, list);
      }
    }
  }
  await walk(root, root.name);
  return [...groups.entries()]
    .map(([folder, files]) => ({ folder, files: files.sort((a, b) => a.path.localeCompare(b.path)) }))
    .sort((a, b) => a.folder.localeCompare(b.folder, 'es', { numeric: true }));
}

/** Vuelve a leer del disco los KML/KMZ de una carpeta (tras guardar o renombrar). */
export async function refreshGroup(group: FileGroup): Promise<FileGroup> {
  const dir = group.files.find((f) => f.dir)?.dir;
  if (!dir) return group;
  const files: SourceFile[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !isRouteFile(entry.name)) continue;
    const handle = entry as FileSystemFileHandle;
    files.push({ file: await handle.getFile(), path: `${group.folder}/${entry.name}`, handle, dir });
  }
  return { ...group, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

async function ensureWritable(handle: FileSystemHandle) {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') return;
  if ((await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Permiso de escritura denegado');
  }
}

async function writeHandle(handle: FileSystemFileHandle, content: string) {
  await ensureWritable(handle);
  const w = await handle.createWritable();
  await w.write(new Blob([content], { type: 'application/vnd.google-earth.kml+xml' }));
  await w.close();
}

export function download(fileName: string, content: string | Blob) {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'application/vnd.google-earth.kml+xml' }) : content;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SaveResult = {
  mode: 'overwrite' | 'new-file' | 'moved' | 'save-as' | 'download';
  fileName: string;
  /** Nuevo origen del archivo (para que el siguiente guardado sobrescriba éste). */
  source?: SourceFile;
};

/** Nombre válido para Windows. */
export const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/** Partes válidas de una carpeta "A/B/C". */
export const folderParts = (folder?: string) =>
  folder
    ?.split('/')
    .map((p) => safeFileName(p))
    .filter(Boolean) ?? [];

/**
 * Guarda el KML procesado en `<carpeta del archivo original>/<folder>/<outBase>.kml`:
 *  - si ya es ese mismo .kml → lo sobrescribe
 *  - si era un .kml en otro lugar o con otro nombre → lo mueve / renombra
 *  - .kmz, archivo con varios trazos o ruta alterna (`isNew`) → crea el .kml y conserva el original
 *  - sin acceso a la carpeta → con `ask`, "Guardar como" (el usuario elige carpeta y nombre;
 *    debe llamarse desde un clic); si no, descarga
 */
export async function saveKml(src: SourceFile, outBase: string, content: string, folder?: string, ask = false): Promise<SaveResult> {
  const fileName = `${safeFileName(outBase)}.kml`;
  const isKml = !src.isNew && src.file.name.toLowerCase().endsWith('.kml');
  const sub = folderParts(folder);
  const base = src.baseDir ?? src.dir;
  const basePath = src.basePath ?? src.path.replace(/\/?[^/]*$/, '');

  if (!base) {
    // Archivo suelto: sólo se puede sobrescribir en su lugar (sin carpetas), guardar como o descargar
    if (sub.length === 0 && isKml && src.file.name === fileName && src.handle) {
      await writeHandle(src.handle, content);
      return { mode: 'overwrite', fileName, source: { ...src, file: await src.handle.getFile() } };
    }
    if (ask && supportsSaveAs()) {
      // si se conoce el archivo original, el diálogo abre en su carpeta; si no, en la última usada
      const target = await window.showSaveFilePicker!({
        suggestedName: fileName,
        id: 'geo-direction-kml',
        ...(src.handle && { startIn: src.handle }),
        types: [{ description: 'KML', accept: { 'application/vnd.google-earth.kml+xml': ['.kml'] } }],
      });
      await writeHandle(target, content);
      const file = await target.getFile();
      // a partir de aquí "Guardar" sobrescribe ese archivo sin volver a preguntar
      return { mode: 'save-as', fileName: file.name, source: { file, path: file.name, handle: target } };
    }
    download(fileName, content);
    return { mode: 'download', fileName };
  }

  await ensureWritable(base);
  let targetDir = base;
  for (const part of sub) targetDir = await targetDir.getDirectoryHandle(part, { create: true });
  const sameDir = !!src.dir && (await targetDir.isSameEntry(src.dir));
  const target = await targetDir.getFileHandle(fileName, { create: true });
  await writeHandle(target, content);
  const sameFile = sameDir && src.file.name === fileName;
  // mover / renombrar: el .kml original no debe quedar duplicado
  if (isKml && !sameFile && src.dir) await src.dir.removeEntry(src.file.name);

  const relName = [...sub, fileName].join('/');
  return {
    mode: sameFile ? 'overwrite' : isKml && !sameDir ? 'moved' : 'new-file',
    fileName: relName,
    source: {
      file: await target.getFile(),
      path: [basePath, relName].filter(Boolean).join('/'),
      handle: target,
      dir: targetDir,
      baseDir: base,
      basePath,
    },
  };
}

/** Descarga un ZIP con la estructura de carpetas (cuando no hay acceso directo al disco). */
export async function downloadZip(zipName: string, entries: { path: string; content: string }[]) {
  const zip = new JSZip();
  for (const e of entries) zip.file(e.path, e.content);
  download(zipName, await zip.generateAsync({ type: 'blob' }));
}
