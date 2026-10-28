import { useState, type ReactNode } from 'react';
import { Icon } from '@ui';
import type { Route } from '../services/route';

interface Props {
  routes: Route[];
  /** Carpetas creadas a mano que todavía no tienen trazos. */
  extraFolders: string[];
  /** Se está escribiendo el nombre de una carpeta nueva (lo abre el botón de aquí o el cajón de herramientas). */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  renderRoute: (r: Route) => ReactNode;
  onMove: (routeId: string, folder: string) => void;
  onCreate: (folder: string) => void;
  onRename: (from: string, to: string) => void;
  /** `withRoutes`: también elimina sus trazos y subcarpetas; si no, suben un nivel. */
  onDelete: (folder: string, withRoutes: boolean) => void;
}

const DRAG_TYPE = 'application/x-ruta-id';
const clean = (name: string) =>
  name
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');

/** Todas las carpetas, incluyendo las intermedias ("A/B" implica "A"). */
export function allFolders(routes: Route[], extra: string[]): string[] {
  const set = new Set<string>();
  for (const f of [...routes.map((r) => r.folder), ...extra]) {
    const parts = f.split('/').filter(Boolean);
    parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

function NameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      className="folder-input"
      value={value}
      placeholder="Nombre (usa / para subcarpetas)"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(clean(value) || null);
        if (e.key === 'Escape') onDone(null);
      }}
      onBlur={() => onDone(clean(value) || null)}
    />
  );
}

export function FolderTree({ routes, extraFolders, creating, onCreatingChange, renderRoute, onMove, onCreate, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Carpeta con trazos a la que se le pidió eliminar: se pregunta qué hacer con ellos. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const folders = allFolders(routes, extraFolders);
  const loose = routes.filter((r) => !r.folder);
  const count = (f: string) => routes.filter((r) => r.folder === f || r.folder.startsWith(f + '/')).length;
  const hidden = (f: string) => {
    const parts = f.split('/');
    return parts.slice(0, -1).some((_, i) => collapsed[parts.slice(0, i + 1).join('/')]);
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      onMove(id, folder);
    },
  });

  const routeItem = (r: Route) => (
    <div
      key={r.id}
      draggable
      // no arrastrar la tarjeta al seleccionar texto en un campo o usar un control
      onMouseDown={(e) => {
        e.currentTarget.draggable = !(e.target as HTMLElement).closest('input, textarea, select, button');
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, r.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setDropTarget(null)}
    >
      {renderRoute(r)}
    </div>
  );

  return (
    <section className="folders">
      <div className="row section-head">
        <h2>Carpetas y trazos</h2>
        <span className="spacer" />
        <button className="quiet" onClick={() => onCreatingChange(true)}>
          <Icon name="folder-plus" /> Nueva carpeta
        </button>
      </div>
      {creating && (
        <NameInput
          initial=""
          onDone={(name) => {
            onCreatingChange(false);
            if (name) onCreate(name);
          }}
        />
      )}

      {folders.map((f) => {
        if (hidden(f)) return null;
        const depth = f.split('/').length - 1;
        const items = routes.filter((r) => r.folder === f);
        const isCollapsed = collapsed[f];
        return (
          <div key={f} className={`folder ${dropTarget === f ? 'drop' : ''}`} style={{ marginLeft: depth * 14 }} {...dropProps(f)}>
            <div className="folder-head">
              <button
                className="icon"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Mostrar' : 'Ocultar'} los trazos de ${f.split('/').pop()}`}
                onClick={() => setCollapsed((c) => ({ ...c, [f]: !c[f] }))}
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={14} />
              </button>
              {renaming === f ? (
                <NameInput
                  initial={f}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name && name !== f) onRename(f, name);
                  }}
                />
              ) : (
                <>
                  <span className="folder-name" onDoubleClick={() => setRenaming(f)} title="Doble clic para renombrar">
                    <Icon name="folder-open" size={15} /> {f.split('/').pop()}
                  </span>
                  <span className="small muted">({count(f)})</span>
                  <span className="spacer" />
                  <button className="icon" title="Renombrar carpeta" aria-label={`Renombrar la carpeta ${f.split('/').pop()}`} onClick={() => setRenaming(f)}>
                    <Icon name="pencil" size={14} />
                  </button>
                  <button
                    className="icon"
                    title="Eliminar carpeta"
                    aria-label={`Eliminar la carpeta ${f.split('/').pop()}`}
                    onClick={() => (count(f) > 0 ? setConfirming(f) : onDelete(f, true))}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </>
              )}
            </div>
            {confirming === f && (
              <div className="folder-confirm">
                <span className="small">
                  ¿Eliminar «{f.split('/').pop()}»? Tiene {count(f)} trazo(s).
                </span>
                <div className="row">
                  <button
                    title={`Los trazos y subcarpetas pasan a ${f.includes('/') ? `«${f.slice(0, f.lastIndexOf('/'))}»` : '«Sin carpeta»'}`}
                    onClick={() => {
                      setConfirming(null);
                      onDelete(f, false);
                    }}
                  >
                    Sólo la carpeta
                  </button>
                  <button
                    className="danger"
                    title="Quita la carpeta, sus subcarpetas y sus trazos de la lista (no borra archivos del disco)"
                    onClick={() => {
                      setConfirming(null);
                      onDelete(f, true);
                    }}
                  >
                    Carpeta y trazos
                  </button>
                  <button onClick={() => setConfirming(null)}>Cancelar</button>
                </div>
              </div>
            )}
            {!isCollapsed && items.map(routeItem)}
            {!isCollapsed && items.length === 0 && count(f) === 0 && <div className="small muted folder-empty">Arrastra trazos aquí</div>}
          </div>
        );
      })}

      {(loose.length > 0 || folders.length > 0) && (
        <div className={`folder root ${dropTarget === '' ? 'drop' : ''}`} {...dropProps('')}>
          {folders.length > 0 && (
            <div className="folder-head">
              <span className="folder-name muted">Sin carpeta (junto al archivo original)</span>
            </div>
          )}
          {loose.map(routeItem)}
        </div>
      )}
    </section>
  );
}
