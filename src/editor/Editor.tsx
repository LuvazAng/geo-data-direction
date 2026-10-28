import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { Fold, useTheme } from '@ui';
import type { Basemap } from './map/basemap';
import { MapView } from './map/MapView';
import { RouteRow } from './routes/RouteRow';
import { NameAssistant } from './routes/NameAssistant';
import { RouteInspector } from './routes/RouteInspector';
import type { ColoniasView, RouteActions, ShapeToolId } from './routes/types';
import { InvertSuggestions, PairsSection } from './organize/Comparison';
import { GroupNav } from './panel/GroupNav';
import { LoadErrors } from './panel/LoadErrors';
import { DropOverlay, EditBanner } from './map/MapOverlays';
import { EditBar } from './map/EditBar';
import { MapToolbar } from './map/MapToolbar';
import { NoticeToast } from './panel/NoticeToast';
import { PanelFooter } from './panel/PanelFooter';
import { PanelHeader } from './panel/PanelHeader';
import { ReviewBanner } from './panel/ReviewBanner';
import { Welcome } from './panel/Welcome';
import { OrgPanel } from './organize/OrgPanel';
import { FolderTree, allFolders } from './organize/FolderTree';
import { ToolsDrawer } from './tools/ToolsDrawer';
import { buildTools } from './tools/tools';
import { baseCoords, coordsOf, type Route } from './services/route';
import { supportsFsAccess } from './services/files';
import { coloniasAlong, parseName, simplify } from '@core';
import { restorePatch } from './state/routes';
import { duplasWithLetters, splitPending, type ReviewEditor } from './state/review';
import type { ToolFacts } from './state/tools';
import { useColonias } from './hooks/useColonias';
import { useFileSession } from './hooks/useFileSession';
import { useNameSuggestions } from './hooks/useNameSuggestions';
import { useNotice } from './hooks/useNotice';
import { useOrganization } from './hooks/useOrganization';
import { useRouteEditing } from './hooks/useRouteEditing';
import { useRouteList } from './hooks/useRouteList';
import { useRouteInfo } from './hooks/useRouteInfo';
import { useSaving } from './hooks/useSaving';
import { useReview, type ReviewServer } from './hooks/useReview';
import { useShortcuts } from './hooks/useShortcuts';
import { useSnap } from './hooks/useSnap';

/** Lo que el centro de control puede pedirle al editor. */
export interface EditorBridge {
  /** Abre un archivo (p. ej. uno que generó el orquestador) como si se hubiera abierto suelto. */
  openFile: (file: File) => void;
  /** Abre el original de un mapa para resolver a mano sus conflictos o evaluarlo. */
  openReview: (
    file: File,
    lote: string,
    traza: string,
    indice: number,
    nombres: { indice: number; nombre: string }[],
    totalTrazos: number,
    pendientes: { traza: string; indice: number; nombre?: string }[],
    mapa?: string,
  ) => Promise<void>;
}

interface Props {
  /** El centro de control está abierto encima: el editor no recibe atajos. */
  controlOpen: boolean;
  /** Ejecuciones del centro de control en curso (insignia del botón). */
  controlRunning: number;
  onOpenControl: () => void;
  onCloseControl: () => void;
  /** Lo que el editor le pide al servidor al resolver una revisión. */
  server: ReviewServer;
  /** El centro de control, que se pinta dentro del editor (encima del mapa). */
  renderControl: (editor: EditorBridge) => ReactNode;
}

/** El editor de trayectos: mapa, lista de trazos con su inspector, herramientas, organización, carpetas y guardado. */
export function Editor({ controlOpen, controlRunning, onOpenControl, onCloseControl, server, renderControl }: Props) {
  const { routes, setRoutes, selectedId, editId, setEditId, fit, patchRoute, select, toggleEdit, fitTo, load, invert, setGeometry, undo, byId } =
    useRouteList();
  const [tolerance, setTolerance] = useState(50);
  const [basemap, setBasemap] = useState<Basemap>('calles');
  const [lanes, setLanes] = useState(true);
  /** Opacidad general de los trazos en el mapa. */
  const [routesOpacity, setRoutesOpacity] = useState(1);
  const [reviewEditor, setReviewEditor] = useState<ReviewEditor | null>(null);
  /** El cajón de herramientas, abierto en su lista o directamente en los atajos. */
  const [drawer, setDrawer] = useState<'herramientas' | 'atajos' | null>(null);
  /** Trazo en el que está abierta la herramienta de simplificar (las otras dos son `editId` y el ajuste a calles). */
  const [simplifyId, setSimplifyId] = useState<string | null>(null);
  /** Se está escribiendo el nombre de una carpeta nueva. */
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [theme, setTheme] = useTheme();
  /** El selector de archivos (oculto); se guarda como estado para poder abrirlo desde botones y desde el cajón. */
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const openFilesDialog = () => fileInput?.click();
  const { colonias, showColonias, setShowColonias } = useColonias();
  const setCenterOpen = useCallback((open: boolean) => (open ? onOpenControl() : onCloseControl()), [onOpenControl, onCloseControl]);
  const { notice, notify, runNoticeAction, dropUndo } = useNotice();

  // ------------------------------------------------------------------ datos derivados (direcciones y calles de un sentido)

  const { checkOneways } = useRouteInfo(routes, patchRoute);

  const {
    org,
    pairs,
    suggestions,
    mapRoutes,
    createdAlts,
    duplaOf,
    reviewGroups,
    relationFor,
    junctions,
    altChoice,
    chooseMain,
    setVertex,
    reset: resetOrganization,
    hints,
  } = useOrganization({ routes, byId, tolerance, selectedId, reviewEditor });

  const { extraFolders, resetFolders, createAlternative, moveToFolder, createFolder, renameFolder, removeRoute, deleteFolder, assignFolders } = useRouteEditing(
    { routes, setRoutes, patchRoute, selectedId, select, fitTo, byId, org, relationFor, notify },
  );

  // ------------------------------------------------------------------ carga

  const {
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
  } = useFileSession({ notify, load, setEditId, dropUndo, resetFolders, resetOrganization });

  // Colonias por las que pasa el trazo seleccionado, en su sentido
  const selectedCoords = selectedId && byId[selectedId] ? coordsOf(byId[selectedId]) : undefined;
  const selectedColonias = useMemo(
    () => (colonias.index && selectedCoords ? coloniasAlong(selectedCoords, colonias.index) : null),
    [colonias.index, selectedCoords],
  );
  const coloniasView: ColoniasView = colonias.error
    ? { state: 'error', message: colonias.error }
    : selectedColonias
      ? { state: 'ok', result: selectedColonias }
      : { state: 'loading' };

  // ------------------------------------------------------------------ acciones

  const { snapId, setSnapDist, snapView, snapPreview, startSnap, applySnap, cancelSnap } = useSnap({ byId, selectedId, setGeometry, notify });

  // Una sola herramienta de forma abierta a la vez: al activar una (también con la tecla E) se cierran las otras
  useEffect(() => {
    if (!editId) return;
    cancelSnap();
    setSimplifyId(null);
  }, [editId, cancelSnap]);
  useEffect(() => {
    if (simplifyId && simplifyId !== selectedId) setSimplifyId(null);
  }, [simplifyId, selectedId]);

  const toolOf = (id: string): ShapeToolId | null => (id === editId ? 'edit' : id === snapId ? 'snap' : id === simplifyId ? 'simplify' : null);

  // ------------------------------------------------------------------ guardar / exportar

  const { contentFor, saveOne, saveAll, saveAllAndNext, exportFoldered } = useSaving({
    routes,
    patchRoute,
    coloniasIndex: colonias.index,
    notify,
    groups,
    setGroups,
    groupIndex,
    setGroupIndex,
    rootDirs,
    markDone,
    goToGroup,
  });

  const { openReview, saveReview, cancelReview } = useReview({
    reviewEditor,
    setReviewEditor,
    routes,
    reviewGroups,
    contentFor,
    openFiles,
    setBusy,
    setCenterOpen,
    notify,
    server,
  });

  const nameAssistant = useNameSuggestions({
    reviewEditor,
    routes,
    selectedId,
    duplaOf,
    index: colonias.index,
    patchRoute,
    notify,
    server,
  });

  const actionsFor = (r: Route): RouteActions => ({
    select: () => select(r.id),
    invert: () => invert(r.id),
    toggle: () => patchRoute(r.id, { visible: !r.visible }),
    zoom: () => fitTo([r.id]),
    rename: (outName) => patchRoute(r.id, { outName, saved: undefined }),
    setFolder: (folder) => moveToFolder(r.id, folder),
    save: () => saveOne(r),
    retryOneways: () => checkOneways(r.id, baseCoords(r)),
    simplify: (tol) => setGeometry(r.id, simplify(coordsOf(r), tol)),
    simplifyClose: () => setSimplifyId(null),
    snapDistance: setSnapDist,
    snapApply: applySnap,
    snapCancel: cancelSnap,
    toggleEdit: () => toggleEdit(r.id),
    undo: () => undo(r.id),
    restore: () => patchRoute(r.id, restorePatch),
    suggestName: reviewEditor && colonias.index ? nameAssistant.open : undefined,
    remove: () => removeRoute(r.id),
  });

  // ------------------------------------------------------------------ atajos

  useShortcuts({
    disabled: controlOpen || drawer !== null,
    routes,
    selectedId,
    hasNoticeAction: !!notice?.action,
    runNoticeAction,
    reviewing: !!reviewEditor,
    groupIndex,
    setEditId,
    actions: {
      undo,
      invert,
      removeRoute,
      cancelEditAndSnap: () => {
        setEditId(null);
        cancelSnap();
      },
      goToGroup,
      fitTo,
      select,
      saveReview,
      saveAll,
      saveAllAndNext,
    },
  });

  const openFile = (file: File) => {
    void openFiles([{ file, path: file.name }]);
    notify(`Abierto en el editor: ${file.name}`);
  };

  // ------------------------------------------------------------------ herramientas

  const nonAlt = routes.filter((r) => !r.alt);
  const showOrg = !!org && (nonAlt.length > 2 || Object.keys(org.relations).length > 0);
  const hasDir = routes.some((r) => r.source.dir || r.source.baseDir);
  const hasNext = groups.length > 0 && groupIndex < groups.length - 1;
  const canPickFolder = supportsFsAccess();
  const selected = selectedId ? byId[selectedId] : undefined;

  const facts: ToolFacts = {
    hasRoutes: routes.length > 0,
    hasSelection: !!selected,
    reviewing: !!reviewEditor,
    selectedNameFormatOk: !!selected && !!parseName(selected.outName),
    selectedEdited: !!selected?.edited,
    selectedHasHistory: !!selected?.history?.length,
    invertReasons: suggestions.find((s) => s.route.id === selectedId)?.reasons ?? [],
    canPickFolder,
    hasGroups: groups.length > 0,
    hasNext,
    canSplit: showOrg,
    hasLooseRoutes: routes.some((r) => !r.folder),
    coloniasReady: !!colonias.index,
    coloniasError: colonias.error,
  };

  const onSelected = (act: (id: string) => void) => () => {
    if (selectedId) act(selectedId);
  };
  const tools = buildTools({
    facts,
    reviewing: !!reviewEditor,
    hasDir,
    tolerance,
    setTolerance,
    basemap,
    setBasemap,
    lanes,
    setLanes,
    showColonias,
    setShowColonias,
    routesOpacity,
    setRoutesOpacity,
    active: {
      edit: !!selectedId && editId === selectedId,
      simplify: !!selectedId && simplifyId === selectedId,
      snap: !!selectedId && snapId === selectedId,
    },
    selectedOpacity: selected?.opacity ?? 1,
    setSelectedOpacity: (opacity) => selectedId && patchRoute(selectedId, { opacity }),
    theme,
    setTheme,
    run: {
      openFolder: () => void pickFolder(),
      openFiles: openFilesDialog,
      saveAll: () => void saveAll(),
      saveAllAndNext: () => void saveAllAndNext(),
      saveReview: () => void saveReview(),
      exportKml: () => void exportFoldered(),
      invert: onSelected(invert),
      edit: onSelected((id) => {
        setSimplifyId(null);
        cancelSnap();
        toggleEdit(id);
      }),
      // pulsar una herramienta que ya está abierta la cierra
      simplify: onSelected((id) => {
        setEditId(null);
        cancelSnap();
        setSimplifyId((current) => (current === id ? null : id));
      }),
      snap: onSelected((id) => {
        setEditId(null);
        setSimplifyId(null);
        if (snapId === id) cancelSnap();
        else startSnap(id);
      }),
      restore: onSelected((id) => patchRoute(id, restorePatch)),
      undo: onSelected(undo),
      zoom: onSelected((id) => fitTo([id])),
      suggestName: nameAssistant.open,
      fitAll: () => fitTo(routes.map((r) => r.id)),
      newFolder: () => setCreatingFolder(true),
      splitDuplas: assignFolders,
    },
  });

  // ------------------------------------------------------------------ UI

  const folders = allFolders(routes, extraFolders);
  const reviewRemoved = reviewEditor ? splitPending(reviewEditor, routes).removed : [];
  // duplas que se registrarán al evaluar el mapa a mano, en orden, con las letras de sus trazos
  const reviewDuplas = duplasWithLetters(reviewGroups, byId);
  // arrastrar archivos desde el explorador (no las tarjetas de trazos entre carpetas)
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const renderRoute = (r: Route) => {
    const best = org?.relations[r.id]?.[0];
    const on = actionsFor(r);
    const isSelected = r.id === selectedId;
    const altLabel = r.alt && `Alterna: ${byId[r.alt.mainId]?.letter ?? '?'} + ${byId[r.alt.shortId]?.letter ?? '?'}`;
    return (
      <RouteRow
        key={r.id}
        route={r}
        selected={isSelected}
        role={org?.role[r.id]}
        dupla={duplaOf[r.id]}
        relation={best && { mainLetter: byId[best.mainId]?.letter ?? '?', kind: best.kind, needsReverse: best.needsReverse }}
        altLabel={altLabel || undefined}
        on={on}
      >
        <RouteInspector
          route={r}
          folders={folders}
          tool={toolOf(r.id)}
          manualReview={!!reviewEditor}
          hint={hints[r.id]}
          snap={r.id === snapId ? snapView : undefined}
          colonias={coloniasView}
          assistant={isSelected && nameAssistant.view ? <NameAssistant view={nameAssistant.view} on={nameAssistant.on} /> : undefined}
          on={on}
        />
      </RouteRow>
    );
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (isFileDrag(e)) void onDrop(e);
      }}
    >
      <main className="map-wrap">
        <MapView
          routes={mapRoutes}
          selectedId={selectedId}
          onSelect={select}
          basemap={basemap}
          lanes={lanes && !editId}
          opacity={routesOpacity}
          fit={fit}
          editId={editId}
          onEdit={setGeometry}
          junctions={junctions}
          preview={snapPreview}
          colonias={colonias.index?.data ?? null}
          showColonias={showColonias}
          coloniasRuta={selectedColonias}
        />
        <div className="map-top">
          {routes.length > 0 && <EditBar tools={tools} selected={selected} />}
          <MapToolbar
            basemap={basemap}
            onBasemap={setBasemap}
            lanes={lanes}
            onLanes={setLanes}
            coloniasError={colonias.error}
            coloniasReady={!!colonias.index}
            showColonias={showColonias}
            onShowColonias={setShowColonias}
            opacity={routesOpacity}
            onOpacity={setRoutesOpacity}
          />
        </div>
        {editId && byId[editId] && <EditBanner letter={byId[editId].letter} />}
        {dragging && <DropOverlay />}
      </main>

      {renderControl({ openFile, openReview })}

      <aside className="panel">
        <input
          ref={setFileInput}
          type="file"
          accept=".kml,.kmz"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).map((file) => ({ file, path: file.name }));
            e.target.value = '';
            if (files.length) void openFiles(files);
          }}
        />
        <PanelHeader
          controlRunning={controlRunning}
          onOpenControl={onOpenControl}
          busy={busy}
          hasRoutes={routes.length > 0}
          canPickFolder={canPickFolder}
          onPickFolder={() => void pickFolder()}
          onOpenFiles={openFilesDialog}
          onOpenTools={() => setDrawer('herramientas')}
        />

        {groups.length > 0 && <GroupNav groups={groups} groupIndex={groupIndex} done={done} busy={busy} onGo={goToGroup} />}

        <div className="panel-body">
          {routes.length === 0 && !busy && (
            <Welcome
              busy={busy}
              canPickFolder={canPickFolder}
              onPickFolder={() => void pickFolder()}
              onOpenFiles={openFilesDialog}
              onOpenTools={() => setDrawer('herramientas')}
            />
          )}
          {busy && (
            <p className="muted loading-line">
              <span className="spinner" aria-hidden="true" /> Abriendo tus rutas…
            </p>
          )}

          {reviewEditor && <ReviewBanner review={reviewEditor} routeCount={routes.length} removed={reviewRemoved} duplas={reviewDuplas} />}

          <InvertSuggestions suggestions={suggestions} onInvert={invert} />

          {routes.length > 0 && (
            <FolderTree
              routes={routes}
              extraFolders={extraFolders}
              creating={creatingFolder}
              onCreatingChange={setCreatingFolder}
              renderRoute={renderRoute}
              onMove={moveToFolder}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
            />
          )}

          <PairsSection pairs={pairs} tolerance={tolerance} onInvert={invert} />

          {showOrg && (
            <Fold title="Duplas y ampliaciones" count={org!.duplas.length}>
              <OrgPanel
                org={org!}
                routes={routes}
                createdAlts={createdAlts}
                choice={altChoice}
                relationFor={relationFor}
                onChoose={chooseMain}
                onVertex={setVertex}
                onCreateAlt={createAlternative}
                onAssignFolders={assignFolders}
                onSelect={select}
              />
            </Fold>
          )}

          <LoadErrors errors={errors} />
        </div>

        <PanelFooter
          hasRoutes={routes.length > 0}
          reviewing={!!reviewEditor}
          busy={busy}
          hasDir={hasDir}
          hasNext={hasNext}
          onSaveReview={() => void saveReview()}
          onCancelReview={cancelReview}
          onSaveAll={saveAll}
          onSaveAllAndNext={saveAllAndNext}
          onOpenShortcuts={() => setDrawer('atajos')}
        />

        {drawer && <ToolsDrawer key={drawer} tools={tools} initialView={drawer} onClose={() => setDrawer(null)} />}
      </aside>

      <NoticeToast notice={notice} onAction={runNoticeAction} />
    </div>
  );
}
