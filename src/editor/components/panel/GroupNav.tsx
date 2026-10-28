import type { FileGroup } from '../../services/files';

interface Props {
  groups: FileGroup[];
  groupIndex: number;
  /** Carpetas ya terminadas. */
  done: Record<string, boolean>;
  busy: boolean;
  onGo: (index: number) => void;
}

/** Recorrido carpeta por carpeta: anterior, lista, siguiente y avance. */
export function GroupNav({ groups, groupIndex, done, busy, onGo }: Props) {
  const group = groups[groupIndex];
  const doneCount = groups.filter((g) => done[g.folder]).length;
  return (
    <section className="group-nav">
      <div className="row">
        <button onClick={() => onGo(groupIndex - 1)} disabled={groupIndex === 0 || busy} title="Anterior (P)">
          ◀
        </button>
        <select value={groupIndex} onChange={(e) => onGo(Number(e.target.value))} disabled={busy}>
          {groups.map((g, i) => (
            <option key={g.folder} value={i}>
              {done[g.folder] ? '✓ ' : '· '}
              {g.folder} ({g.files.length})
            </option>
          ))}
        </select>
        <button onClick={() => onGo(groupIndex + 1)} disabled={groupIndex >= groups.length - 1 || busy} title="Siguiente (N)">
          ▶
        </button>
      </div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${(doneCount / groups.length) * 100}%` }} />
        <span>
          {doneCount} / {groups.length} carpetas listas · {group && `${groupIndex + 1}ª: ${group.folder}`}
        </span>
      </div>
    </section>
  );
}
