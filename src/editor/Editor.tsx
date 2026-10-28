import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { MapView, type Basemap } from './components/MapView';
import { RouteCard, type ColoniasView, type RouteActions } from './components/RouteCard';
import { InvertSuggestions, PairsSection } from './components/panel/Comparison';
import { GroupNav } from './components/panel/GroupNav';
import { LoadErrors } from './components/panel/LoadErrors';
import { DropOverlay, EditBanner, EmptyState } from './components/panel/MapOverlays';
import { MapToolbar } from './components/panel/MapToolbar';
import { NoticeToast } from './components/panel/NoticeToast';
import { PanelFooter } from './components/panel/PanelFooter';
import { PanelHeader } from './components/panel/PanelHeader';
import { ReviewBanner } from './components/panel/ReviewBanner';
import { OrgPanel } from './components/OrgPanel';
import { FolderTree, allFolders } from './components/FolderTree';
import { baseCoords, coordsOf, type Route } from './services/route';
import { coloniasAlong, simplify } from '@core';
import { restorePatch } from './state/routes';
import { duplasWithLetters, splitPending, type ReviewEditor } from './state/review';
import { useColonias } from './hooks/useColonias';
import { useFileSession } from './hooks/useFileSession';
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

/** El editor de trayectos: mapa, tarjetas de cada trazo, organización, carpetas y guardado. */
export function Editor({ controlOpen, controlRunning, onOpenControl, onCloseControl, server, renderControl }: Props) {
  const { routes, setRoutes, selectedId, editId, setEditId, fit, patchRoute, select, toggleEdit, fitTo, load, invert, setGeometry, undo, byId } =
    useRouteList();
  const [tolerance, setTolerance] = useState(50);
  const [basemap, setBasemap] = useState<Basemap>('calles');
  const [lanes, setLanes] = useState(true);
  /** Opacidad general de los trazos en el mapa. */
  const [routesOpacity, setRoutesOpacity] = useState(1);
  const [reviewEditor, setReviewEditor] = useState<ReviewEditor | null>(null);
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

  const actionsFor = (r: Route): RouteActions => ({
    select: () => select(r.id),
    invert: () => invert(r.id),
    toggle: () => patchRoute(r.id, { visible: !r.visible }),
    setOpacity: (opacity) => patchRoute(r.id, { opacity }),
    zoom: () => fitTo([r.id]),
    rename: (outName) => patchRoute(r.id, { outName, saved: undefined }),
    setFolder: (folder) => moveToFolder(r.id, folder),
    save: () => saveOne(r),
    retryOneways: () => checkOneways(r.id, baseCoords(r)),
    simplify: (tol) => setGeometry(r.id, simplify(coordsOf(r), tol)),
    snapStart: () => startSnap(r.id),
    snapDistance: setSnapDist,
    snapApply: applySnap,
    snapCancel: cancelSnap,
    toggleEdit: () => toggleEdit(r.id),
    undo: () => undo(r.id),
    restore: () => patchRoute(r.id, restorePatch),
    remove: () => removeRoute(r.id),
  });

  // ------------------------------------------------------------------ atajos

  useShortcuts({
    disabled: controlOpen,
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

  // ------------------------------------------------------------------ UI

  const nonAlt = routes.filter((r) => !r.alt);
  const showOrg = !!org && (nonAlt.length > 2 || Object.keys(org.relations).length > 0);
  const hasDir = routes.some((r) => r.source.dir || r.source.baseDir);
  const folders = allFolders(routes, extraFolders);
  const reviewRemoved = reviewEditor ? splitPending(reviewEditor, routes).removed : [];
  // duplas que se registrarán al evaluar el mapa a mano, en orden, con las letras de sus trazos
  const reviewDuplas = duplasWithLetters(reviewGroups, byId);
  // arrastrar archivos desde el explorador (no las tarjetas de trazos entre carpetas)
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const renderRoute = (r: Route) => {
    const best = org?.relations[r.id]?.[0];
    return (
      <RouteCard
        key={r.id}
        route={r}
        manualReview={!!reviewEditor}
        selected={r.id === selectedId}
        editing={r.id === editId}
        folders={folders}
        role={org?.role[r.id]}
        dupla={duplaOf[r.id]}
        relation={best && { mainLetter: byId[best.mainId]?.letter ?? '?', kind: best.kind, needsReverse: best.needsReverse }}
        altLabel={r.alt && `Alterna: ${byId[r.alt.mainId]?.letter ?? '?'} + ${byId[r.alt.shortId]?.letter ?? '?'}`}
        hint={hints[r.id]}
        snap={r.id === snapId ? snapView : undefined}
        colonias={r.id === selectedId ? coloniasView : undefined}
        on={actionsFor(r)}
      />
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
        {editId && byId[editId] && <EditBanner letter={byId[editId].letter} />}
        {routes.length === 0 && !busy && <EmptyState />}
        {dragging && <DropOverlay />}
      </main>

      {renderControl({ openFile, openReview })}

      <aside className="panel">
        <PanelHeader
          controlRunning={controlRunning}
          onOpenControl={onOpenControl}
          busy={busy}
          onPickFolder={pickFolder}
          onOpenFiles={(files) => void openFiles(files)}
          tolerance={tolerance}
          onTolerance={setTolerance}
        />

        {groups.length > 0 && <GroupNav groups={groups} groupIndex={groupIndex} done={done} busy={busy} onGo={goToGroup} />}

        <div className="panel-body">
          {reviewEditor && <ReviewBanner review={reviewEditor} routeCount={routes.length} removed={reviewRemoved} duplas={reviewDuplas} />}
          {busy && <p className="muted">Cargando…</p>}

          <PairsSection pairs={pairs} tolerance={tolerance} onInvert={invert} />

          <InvertSuggestions suggestions={suggestions} onInvert={invert} />

          {showOrg && (
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
          )}

          {routes.length > 0 && (
            <FolderTree
              routes={routes}
              extraFolders={extraFolders}
              renderRoute={renderRoute}
              onMove={moveToFolder}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
            />
          )}

          <LoadErrors errors={errors} />
        </div>

        <PanelFooter
          hasRoutes={routes.length > 0}
          reviewing={!!reviewEditor}
          busy={busy}
          hasDir={hasDir}
          hasNext={groups.length > 0 && groupIndex < groups.length - 1}
          onSaveReview={() => void saveReview()}
          onCancelReview={cancelReview}
          onSaveAll={saveAll}
          onSaveAllAndNext={saveAllAndNext}
          onExport={exportFoldered}
        />
      </aside>

      <NoticeToast notice={notice} onAction={runNoticeAction} />
    </div>
  );
}
