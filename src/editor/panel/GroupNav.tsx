import { Icon } from '@ui';
import type { FileGroup } from '../services/files';

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
    <section className="group-nav" aria-label="Carpetas por revisar">
      <div className="row">
        <button
          className="quiet"
          onClick={() => onGo(groupIndex - 1)}
          disabled={groupIndex === 0 || busy}
          title="Carpeta anterior (P)"
          aria-label="Carpeta anterior"
        >
          <Icon name="chevron-left" />
        </button>
        <select value={groupIndex} onChange={(e) => onGo(Number(e.target.value))} disabled={busy} aria-label="Carpeta que estás revisando">
          {groups.map((g, i) => (
            <option key={g.folder} value={i}>
              {done[g.folder] ? '✓ ' : '· '}
              {g.folder} ({g.files.length})
            </option>
          ))}
        </select>
        <button
          className="quiet"
          onClick={() => onGo(groupIndex + 1)}
          disabled={groupIndex >= groups.length - 1 || busy}
          title="Carpeta siguiente (N)"
          aria-label="Carpeta siguiente"
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${(doneCount / groups.length) * 100}%` }} />
        <span>
          {doneCount} de {groups.length} carpetas listas · {group && `revisando la ${groupIndex + 1}ª: ${group.folder}`}
        </span>
      </div>
    </section>
  );
}
