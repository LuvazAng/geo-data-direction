import { useCallback, useState, type DragEvent } from 'react';
import { lengthKm, parseKmlAll, readKmlText } from '@core';
import { isRouteFile, refreshGroup, scanDirectory, type FileGroup, type SourceFile } from '../services/files';
import type { Route } from '../services/route';
import { buildRoutes, outputNames, sortLongestFirst, type ParsedEntry } from '../state/routes';
import { loadDone, saveDone } from '../state/storage';
import type { Notify } from './useNotice';

export interface LoadError {
  path: string;
  message: string;
}

interface Deps {
  notify: Notify;
  /** Reemplaza los trazos del editor por los recién leídos. */
  load: (loaded: Route[], selectIndex?: number) => void;
  setEditId: (id: string | null) => void;
  /** Lo que se olvida al cargar otros trazos. */
  dropUndo: () => void;
  resetFolders: () => void;
  resetOrganization: () => void;
}

/**
 * De dónde vienen los trazos: archivos sueltos o una carpeta recorrida carpeta por carpeta (cada
 * subcarpeta es un par ida/vuelta), con las que ya se terminaron recordadas entre sesiones.
 */
export function useFileSession({ notify, load, setEditId, dropUndo, resetFolders, resetOrganization }: Deps) {
  const [errors, setErrors] = useState<LoadError[]>([]);
  const [groups, setGroups] = useState<FileGroup[]>([]);
  /** Carpetas raíz abiertas (para volver a escanear tras mover archivos). */
  const [rootDirs, setRootDirs] = useState<FileSystemDirectoryHandle[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [done, setDone] = useState(loadDone);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadFiles = useCallback(
    async (files: SourceFile[], selectIndex?: number, suggestedNames: { indice: number; nombre: string }[] = []) => {
      setBusy(true);
      setEditId(null);
      const parsedList: ParsedEntry[] = [];
      const errs: LoadError[] = [];
      for (const source of files) {
        try {
          // Un archivo puede traer varios trazos (p. ej. ruta, regreso y ampliaciones)
          for (const parsed of parseKmlAll(await readKmlText(source.file))) {
            parsedList.push({ source, parsed, len: lengthKm(parsed.coords) });
          }
        } catch (e) {
          errs.push({ path: source.path, message: (e as Error).message });
        }
      }
      sortLongestFirst(parsedList);
      const loaded = buildRoutes(parsedList, outputNames(parsedList), suggestedNames);
      load(loaded, selectIndex);
      // un "deshacer" pendiente ya no aplica a los trazos nuevos
      dropUndo();
      resetFolders();
      resetOrganization();
      setErrors(errs);
      setBusy(false);
    },
    [setEditId, load, dropUndo, resetFolders, resetOrganization],
  );

  /** Abre archivos sueltos (sin carpeta): deja de recorrer la carpeta que hubiera. */
  const openFiles = useCallback(
    async (files: SourceFile[], selectIndex?: number, suggestedNames?: { indice: number; nombre: string }[]) => {
      setGroups([]);
      setRootDirs([]);
      await loadFiles(files, selectIndex, suggestedNames);
    },
    [loadFiles],
  );

  const openGroups = useCallback(
    async (found: FileGroup[]) => {
      if (found.length === 0) {
        notify('No se encontraron archivos .kml/.kmz en la carpeta', 'error');
        return;
      }
      setGroups(found);
      // Retoma en la primera carpeta pendiente
      const first = Math.max(
        0,
        found.findIndex((g) => !done[g.folder]),
      );
      setGroupIndex(first);
      await loadFiles(found[first].files);
    },
    [done, loadFiles, notify],
  );

  const goToGroup = useCallback(
    async (index: number) => {
      if (index < 0 || index >= groups.length) return;
      setGroupIndex(index);
      const fresh = await refreshGroup(groups[index]);
      setGroups((gs) => gs.map((g, i) => (i === index ? fresh : g)));
      await loadFiles(fresh.files);
    },
    [groups, loadFiles],
  );

  const pickFolder = async () => {
    try {
      const dir = await window.showDirectoryPicker!({ mode: 'readwrite' });
      setBusy(true);
      setRootDirs([dir]);
      await openGroups(await scanDirectory(dir));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    // Los handles hay que pedirlos de forma síncrona dentro del evento
    const items = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file');
    const handlePromises = items.map((i) => i.getAsFileSystemHandle?.() ?? Promise.resolve(null));
    const plainFiles = Array.from(e.dataTransfer.files);
    const handles = await Promise.all(handlePromises.map((p) => p.catch(() => null)));

    const dirs = handles.filter((h): h is FileSystemDirectoryHandle => h?.kind === 'directory');
    if (dirs.length > 0) {
      setBusy(true);
      try {
        setRootDirs(dirs);
        const all = (await Promise.all(dirs.map(scanDirectory))).flat();
        await openGroups(all);
      } finally {
        setBusy(false);
      }
      return;
    }

    const sources: SourceFile[] = [];
    for (const [i, file] of plainFiles.entries()) {
      if (!isRouteFile(file.name)) continue;
      const h = handles[i];
      sources.push({ file, path: file.name, handle: h?.kind === 'file' ? (h as FileSystemFileHandle) : undefined });
    }
    if (sources.length === 0) {
      notify('Suelta archivos .kml / .kmz o una carpeta', 'error');
      return;
    }
    await openFiles(sources);
  };

  const markDone = useCallback((folder: string) => {
    setDone((d) => {
      const next = { ...d, [folder]: true };
      saveDone(next);
      return next;
    });
  }, []);

  return {
    errors,
    groups,
    setGroups,
    rootDirs,
    groupIndex,
    setGroupIndex,
    done,
    markDone,
    dragging,
    setDragging,
    busy,
    setBusy,
    openFiles,
    goToGroup,
    pickFolder,
    onDrop,
  };
}
