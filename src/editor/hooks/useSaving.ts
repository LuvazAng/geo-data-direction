import { useCallback } from 'react';
import { buildFolderedKml, buildKml, coloniasAlong, coloniasKml, parseKml, type ColoniaIndex } from '@core';
import { baseName, download, downloadZip, saveKml, scanDirectory, type FileGroup } from '../services/files';
import { formatAddress } from '../services/geocode';
import { coordsOf, endAddr, startAddr, type Route } from '../services/route';
import { addrText } from '../state/derived';
import { createdSubfolders, exportTitle, needsZip, zipEntries } from '../state/export';
import type { PatchRoute } from '../state/routes';
import type { Notify } from './useNotice';

interface Deps {
  routes: Route[];
  patchRoute: PatchRoute;
  coloniasIndex: ColoniaIndex | undefined;
  notify: Notify;
  groups: FileGroup[];
  setGroups: (groups: FileGroup[]) => void;
  groupIndex: number;
  setGroupIndex: (index: number) => void;
  rootDirs: FileSystemDirectoryHandle[];
  markDone: (folder: string) => void;
  goToGroup: (index: number) => Promise<void>;
}

/** Guardar los trazos (en su carpeta, con «Guardar como» o en un ZIP) y exportar el KML con carpetas. */
export function useSaving({ routes, patchRoute, coloniasIndex, notify, groups, setGroups, groupIndex, setGroupIndex, rootDirs, markDone, goToGroup }: Deps) {
  /** KML final de un trazo: sólo ese trazo, orientado, con su geometría vigente e INICIO/FINAL. */
  const contentFor = useCallback(
    (r: Route) =>
      buildKml(r.parsed.text, {
        reversed: r.reversed,
        index: r.parsed.index,
        coords: r.edited || r.alt ? coordsOf(r) : undefined,
        name: r.alt || r.parsed.count > 1 ? r.outName : undefined,
        startDescription: formatAddress(addrText(startAddr(r))),
        endDescription: formatAddress(addrText(endAddr(r))),
        colonias: coloniasIndex && coloniasKml(coloniasAlong(coordsOf(r), coloniasIndex)),
      }),
    [coloniasIndex],
  );

  /** `ask`: sin acceso a la carpeta, pregunta dónde guardar en vez de descargar (sólo desde un clic). */
  const saveRoute = useCallback(
    async (r: Route, ask = false) => {
      const content = contentFor(r);
      // De un archivo con varios trazos, cada trazo va a su propio .kml y el original se conserva
      const source = r.parsed.count > 1 ? { ...r.source, isNew: true } : r.source;
      const res = await saveKml(source, r.outName.trim() || baseName(r.source.file.name), content, r.folder, ask);
      const label = {
        overwrite: 'Sobrescrito',
        'new-file': 'Guardado',
        moved: 'Movido',
        'save-as': 'Guardado',
        download: 'Descargado',
      }[res.mode];
      // A partir de aquí el archivo ya va orientado y con la geometría final
      patchRoute(r.id, (cur) => ({
        parsed: res.source ? parseKml(content) : cur.parsed,
        source: res.source ?? cur.source,
        ...(res.source && {
          reversed: false,
          edited: undefined,
          history: undefined,
          addrFirst: cur.reversed ? cur.addrLast : cur.addrFirst,
          addrLast: cur.reversed ? cur.addrFirst : cur.addrLast,
          outName: baseName(res.fileName.split('/').pop()!),
        }),
        saved: `${label}: ${res.fileName}`,
      }));
      return res;
    },
    [patchRoute, contentFor],
  );

  const exportFoldered = () => {
    try {
      const title = exportTitle(groups[groupIndex], routes);
      const kml = buildFolderedKml(
        title,
        routes.map((r) => ({ folder: r.folder, name: r.outName, kml: contentFor(r) })),
      );
      download(`${title} (carpetas).kml`, kml);
      notify('KML con carpetas descargado: ábrelo en Google Earth para revisarlo');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const saveAll = useCallback(async () => {
    if (routes.length === 0) return false;
    try {
      // Sin acceso a la carpeta (archivos abiertos sueltos): un ZIP con la estructura de carpetas
      if (needsZip(routes)) {
        const entries = zipEntries(routes, contentFor);
        await downloadZip(`${exportTitle(groups[groupIndex], routes)}.zip`, entries);
        routes.forEach((r, i) => patchRoute(r.id, { saved: `En el ZIP: ${entries[i].path}` }));
        notify(`ZIP con ${entries.length} archivo(s) descargado`);
        return true;
      }

      const results = [];
      for (const r of routes) results.push(await saveRoute(r));
      const folder = groups[groupIndex]?.folder;
      if (folder) {
        markDone(folder);
        // Si se crearon subcarpetas, se vuelve a escanear para que aparezcan en el navegador
        const subfolders = createdSubfolders(results.map((r) => r.fileName));
        if (subfolders.length > 0 && rootDirs.length > 0) {
          subfolders.forEach((sub) => markDone(`${folder}/${sub}`));
          const found = (await Promise.all(rootDirs.map(scanDirectory))).flat();
          setGroups(found);
          setGroupIndex(
            Math.max(
              0,
              found.findIndex((g) => g.folder === folder),
            ),
          );
        }
      }
      notify(`${routes.length} archivo(s) guardados`);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, saveRoute, contentFor, patchRoute, groups, groupIndex, markDone, notify, rootDirs]);

  const saveOne = async (r: Route) => {
    try {
      const res = await saveRoute(r, true);
      notify(`${r.letter}: ${res.fileName}`);
    } catch (e) {
      // cerró el diálogo de "Guardar como" sin elegir
      if ((e as Error).name === 'AbortError') notify(`${r.letter}: no se guardó`);
      else notify((e as Error).message, 'error');
    }
  };

  const saveAllAndNext = async () => {
    if (await saveAll()) await goToGroup(groupIndex + 1);
  };

  return { contentFor, saveOne, saveAll, saveAllAndNext, exportFoldered };
}
