import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@ui';
import { COMPONENTS, type Component, type Level, type LogEntry } from '@protocol';
import { api } from '../api';
import { duration, time } from '../common';
import type { Centro } from '../useCentro';

const LEVELS: Level[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export const formatLog = (l: LogEntry) =>
  `[${time(l.ts)}] [${l.nivel}] [${l.componente}]${l.jobId ? ` (${l.jobId})` : ''}${l.ruta ? ` ${l.ruta} ·` : ''} ${l.mensaje}${l.duracionMs !== undefined ? ` (${duration(l.duracionMs)})` : ''}`;

/**
 * Consola: muestra los registros que de verdad emiten los componentes (ya sanitizados en el
 * servidor). "Pausar vista" congela lo que se ve; el proceso sigue y los registros siguen llegando.
 */
export function ConsoleView({ centro, openJob, preset }: { centro: Centro; openJob: (id: string) => void; preset?: { jobId?: string } | null }) {
  const { state, call, loadOlderLogs } = centro;
  const [comps, setComps] = useState<Set<Component>>(new Set());
  const [levels, setLevels] = useState<Set<Level>>(new Set(['INFO', 'WARN', 'ERROR']));
  const [ruta, setRuta] = useState('');
  const [jobId, setJobId] = useState(preset?.jobId ?? '');
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [history, setHistory] = useState<LogEntry[] | null>(null);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (preset?.jobId) setJobId(preset.jobId);
  }, [preset]);

  // Historial completo de una ejecución (del disco), combinado con lo que llega en vivo
  useEffect(() => {
    setHistory(null);
    if (!jobId) return;
    let cancel = false;
    api
      .jobLogs(jobId)
      .then((l) => !cancel && setHistory(l))
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [jobId]);

  const source = useMemo(() => {
    const live = frozen ?? state.logs;
    if (!history) return live;
    const seen = new Set(history.map((l) => l.seq));
    return [...history, ...live.filter((l) => l.jobId === jobId && !seen.has(l.seq))];
  }, [frozen, state.logs, history, jobId]);

  const rutas = useMemo(() => [...new Set(state.logs.map((l) => l.ruta).filter(Boolean))].sort() as string[], [state.logs]);
  const jobs = useMemo(() => Object.values(state.jobs).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)), [state.jobs]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      source.filter(
        (l) =>
          (comps.size === 0 || comps.has(l.componente)) &&
          levels.has(l.nivel) &&
          (!ruta || l.ruta === ruta) &&
          (!jobId || l.jobId === jobId) &&
          (!needle || `${l.mensaje} ${l.ruta ?? ''} ${l.componente} ${l.jobId ?? ''}`.toLowerCase().includes(needle)),
      ),
    [source, comps, levels, ruta, jobId, needle],
  );

  useEffect(() => {
    if (follow && !frozen && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow, frozen]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };

  const copy = async () => {
    const text = shown.map(formatLog).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const older = () =>
    call(async () => {
      const oldest = state.logs[0]?.seq;
      const logs = await api.logs({ antesDe: oldest, limite: 500, componente: [...comps], nivel: [...levels], ruta: ruta || undefined, q: q || undefined });
      loadOlderLogs(logs);
      return logs.length;
    });

  return (
    <div className="cc-console">
      <div className="cc-console-filters">
        <div className="row">
          <span className="cc-filter-label small muted">Componente</span>
          {COMPONENTS.map((c) => (
            <button key={c} className={`chip ${comps.has(c) ? 'active' : ''}`} aria-pressed={comps.has(c)} onClick={() => toggle(comps, c, setComps)}>
              {c}
            </button>
          ))}
          {comps.size > 0 && (
            <button className="link" onClick={() => setComps(new Set())}>
              todos
            </button>
          )}
        </div>
        <div className="row">
          <span className="cc-filter-label small muted">Nivel</span>
          {LEVELS.map((lv) => (
            <label key={lv} className={`check small lv-${lv}`}>
              <input type="checkbox" checked={levels.has(lv)} onChange={() => toggle(levels, lv, setLevels)} /> {lv}
            </label>
          ))}
        </div>
        <div className="row">
          <select value={ruta} onChange={(e) => setRuta(e.target.value)} aria-label="Ruta">
            <option value="">todas las rutas</option>
            {rutas.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Ejecución">
            <option value="">todas las ejecuciones</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.id} · {j.unidad.tipo === 'ruta' ? j.unidad.slug : 'fuente'}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row cc-console-bar">
          <label className="check small">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> seguir el último
          </label>
          <button className="quiet compact" onClick={() => setFrozen(frozen ? null : [...state.logs])} title="Congela la vista; el proceso sigue">
            <Icon name={frozen ? 'play' : 'pause'} size={14} /> {frozen ? 'Reanudar la vista' : 'Pausar la vista'}
          </button>
          <button
            className="quiet compact"
            onClick={() => void older()}
            disabled={!!jobId}
            title={jobId ? 'Con una ejecución elegida ya se muestra todo su historial' : 'Registros anteriores del servidor'}
          >
            <Icon name="arrow-up" size={14} /> Cargar anteriores
          </button>
          <button className="quiet compact" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copiado' : `Copiar ${shown.length}`}
          </button>
          <span className="small muted">
            {shown.length} de {source.length}
            {frozen && ` · vista en pausa (${state.logs.length - frozen.length > 0 ? `${state.logs.length - frozen.length} nuevos` : 'sin nuevos'})`}
          </span>
        </div>
      </div>
      <div
        className="cc-console-lines"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight > 60 && follow) setFollow(false);
        }}
      >
        {shown.length === 0 && <div className="muted small">Sin registros con estos filtros.</div>}
        {shown.map((l) => (
          <div key={l.seq} className={`cc-line lv-${l.nivel}`} onClick={() => setOpen(open === l.seq ? null : l.seq)}>
            <span className="t">{time(l.ts)}</span> <span className="lvl">{l.nivel}</span> <span className="comp">[{l.componente}]</span>
            {l.ruta && <span className="ruta"> {l.ruta}</span>} <span className="msg">{l.mensaje}</span>
            {l.duracionMs !== undefined && <span className="dur"> {duration(l.duracionMs)}</span>}
            {open === l.seq && (
              <div className="cc-line-detail" onClick={(e) => e.stopPropagation()}>
                <div className="small">
                  {new Date(l.ts).toISOString()} · seq {l.seq}
                  {l.lote && ` · lote ${l.lote}`}
                  {l.mapa && ` · mapa ${l.mapa}`}
                  {l.jobId && (
                    <>
                      {' '}
                      ·{' '}
                      <button className="link" onClick={() => openJob(l.jobId!)}>
                        ejecución {l.jobId}
                      </button>
                    </>
                  )}
                </div>
                {l.datos && <pre>{JSON.stringify(l.datos, null, 2)}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
