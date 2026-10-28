import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, Popover } from '@ui';
import type { FilesSnapshot, FileView, ReviewItem, ReviewSnapshot } from '@protocol';
import { api } from '../api';
import { Badge, ROUTE_LABEL, routeTone } from '../common';
import type { Navigate } from '../chat/ChatView';
import { fileTone } from '../queue/RunningView';
import type { Centro } from '../useCentro';

const STATE_HELP: Record<string, string> = {
  pendiente: 'detectado en la fuente, todavía no descargado',
  descargado: 'original descargado, sin analizar',
  analizado: 'original analizado',
  generado: 'resultado registrado en el manifiesto, igual que cuando se generó',
  revision: 'copia para revisar en el editor',
  modificado: 'cambió después de generarse',
  falta: 'registrado pero ya no está en disco',
  error: 'no se pudo descargar o leer',
  'en-proceso': 'una ejecución lo está procesando',
};

export function FilesView({ centro, nav, target }: { centro: Centro; nav: Navigate; target: { lote: string; ruta?: string } | null }) {
  const { state, call } = centro;
  const [lote, setLote] = useState(target?.lote ?? state.lotes[0]?.lote ?? '');
  const [ruta, setRuta] = useState<string | undefined>(target?.ruta);
  const [snap, setSnap] = useState<FilesSnapshot | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);
  const [selectedReviews, setSelectedReviews] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (target) {
      setLote(target.lote);
      setRuta(target.ruta);
    }
  }, [target]);
  useEffect(() => {
    if (!lote && state.lotes[0]) setLote(state.lotes[0].lote);
  }, [state.lotes, lote]);

  // Vuelve a pedir la vista cuando el servidor avisa que cambió algo del lote (sin recargar la página)
  const version = state.version[lote] ?? 0;
  useEffect(() => {
    if (!lote || state.conexion !== 'conectado') return;
    let cancel = false;
    const t = setTimeout(() => {
      setLoading(true);
      api
        .files(lote, ruta)
        .then((s) => !cancel && setSnap(s))
        .catch(() => {})
        .finally(() => !cancel && setLoading(false));
      api
        .reviews(lote)
        .then((s) => !cancel && setReviewSnapshot(s))
        .catch(() => {});
    }, 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [lote, ruta, version, state.conexion]);

  const rutas = state.rutas.filter((u) => u.lote === lote);
  // Lo que la ejecución en curso está tocando ahora mismo, por mapa
  const live = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of state.archivosVivos) if (f.lote === lote && f.mapa) m.set(f.mapa, f.estado);
    return m;
  }, [state.archivosVivos, lote]);
  const running = Object.values(state.jobs).find(
    (j) => j.lote === lote && j.estado.startsWith('EN_') && (!ruta || (j.unidad.tipo === 'ruta' && j.unidad.slug === ruta)),
  );
  const online = state.conexion === 'conectado';

  const resolveReviewAction = (traza: string, accion: 'descartar' | 'deshacer') => void call(() => api.resolveReview({ lote, traza, accion }));

  const undoMap = (mapa: string, titulo: string, resolved: ReviewItem[]) => {
    const generated = resolved.filter((item) => item.resolucion?.estado === 'generado').length;
    const discarded = resolved.length - generated;
    const detail = [generated && `${generated} KML generado(s) se moverán a _DESHECHOS`, discarded && `${discarded} descarte(s) se anularán`]
      .filter(Boolean)
      .join(' y ');
    if (!window.confirm(`¿Deshacer la resolución completa de «${titulo}»?\n${detail}; los trazos volverán a quedar pendientes de revisión.`)) return;
    void call(() => api.undoMapReviews({ lote, mapa }));
  };

  // mapas sin itinerarios utilizables y sin decisión: se vuelven a revisar, se evalúan a mano o se descartan
  const noItinerary = new Map((reviewSnapshot?.sinItinerarios ?? []).map((item) => [item.mapa, item]));

  const reprocess = (ruta: string) => void call(() => api.enqueue({ lote, ruta, iniciar: true, parametros: { sinRed: true } }));

  const discardMap = (mapa: string, titulo: string) => {
    if (!window.confirm(`¿Descartar el mapa «${titulo}»?\nNo se generará nada de él y la ruta dejará de esperar su revisión. Se puede deshacer.`)) return;
    void call(() => api.decideMap({ lote, mapa, accion: 'descartar' }));
  };

  const discardSelected = () => {
    if (selectedReviews.size === 0 || !window.confirm(`¿Descartar ${selectedReviews.size} caso(s) de revisión?`)) return;
    void call(async () => {
      for (const traza of selectedReviews) await api.resolveReview({ lote, traza, accion: 'descartar' });
      setSelectedReviews(new Set());
    });
  };

  /** Un archivo: qué es y, a la vista, ver sus detalles, abrirlo en el editor o descartar el caso; deshacer lo resuelto, en «Más». */
  const fileRow = (f: FileView) => {
    const resolved = reviewSnapshot?.resueltas.find((item) => item.traza.id === f.traza);
    const isReview = f.tipo === 'revision' && f.estado !== 'falta' && !!f.traza;
    const canUndo = resolved?.resolucion?.estado === 'generado' && resolved.archivo === f.rel;
    return (
      <li key={f.rel}>
        <span className={`cc-badge ${fileTone(f.estado)}`} title={STATE_HELP[f.estado]}>
          {f.estado}
        </span>{' '}
        <code title={f.rel}>{f.nombre}</code> {f.bytes !== undefined && <span className="small muted">{(f.bytes / 1024).toFixed(1)} KB</span>}
        {f.detalle && <span className="small muted"> · {f.detalle}</span>}
        <span className="row inline">
          {isReview && (
            <label className="small" title="Seleccionar para descartar varios casos a la vez">
              <input
                type="checkbox"
                checked={selectedReviews.has(f.traza!)}
                disabled={!online}
                onChange={(e) =>
                  setSelectedReviews((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(f.traza!);
                    else next.delete(f.traza!);
                    return next;
                  })
                }
              />{' '}
              Seleccionar
            </label>
          )}
          <button className="link" onClick={() => nav.openFile(lote, f.rel)}>
            Detalles
          </button>
          {!isReview && f.estado !== 'falta' && (
            <button className="link" onClick={() => void call(async () => nav.openInEditor(lote, f.rel))}>
              Abrir en el editor
            </button>
          )}
          {isReview && (
            <button
              className="link"
              disabled={!online}
              onClick={() => window.confirm(`¿Descartar «${f.nombre}»?`) && resolveReviewAction(f.traza!, 'descartar')}
              title="No se generará nada de este caso: deja de esperar revisión (se puede deshacer)"
            >
              Descartar
            </button>
          )}
          {canUndo && (
            <Popover menu className="icon" icon="more" label="" title="Más acciones de este archivo" disabled={!online} align="left">
              {(close) => (
                <button
                  className="pop-item"
                  onClick={() => {
                    close();
                    if (window.confirm(`¿Deshacer la resolución de «${f.nombre}»?`)) resolveReviewAction(f.traza!, 'deshacer');
                  }}
                >
                  Deshacer la resolución
                </button>
              )}
            </Popover>
          )}
        </span>
      </li>
    );
  };

  /** Lo que se puede hacer con un mapa: lo que toca ahora a la vista (en uno sin itinerarios, evaluarlo o descartarlo) y deshacer, en «Más». */
  const mapActions = (mapId: string, titulo: string, status: string) => {
    const pendingForMap = reviewSnapshot?.pendientes.filter((item) => item.traza.mapa === mapId) ?? [];
    const resolvedForMap = reviewSnapshot?.resueltas.filter((item) => item.traza.mapa === mapId) ?? [];
    const reviewItem = pendingForMap[0];
    const noItin = noItinerary.get(mapId);
    const undoResolution = (
      <button
        key="undo"
        className="pop-item"
        onClick={() => undoMap(mapId, titulo, resolvedForMap)}
        title="Devuelve a revisión todos los trazos resueltos de este mapa (generados y descartados)"
      >
        Deshacer la resolución ({resolvedForMap.length})
      </button>
    );
    let primary: ReactNode = <span className="small muted">—</span>;
    const more: ReactNode[] = [];

    if (pendingForMap.length > 0) {
      primary = (
        <button
          className="primary compact"
          disabled={!online || !reviewItem?.archivoOriginal}
          onClick={() => {
            if (!reviewItem?.archivoOriginal) return;
            nav.openReview(
              lote,
              reviewItem.archivoOriginal,
              reviewItem.traza.id,
              reviewItem.traza.indice,
              reviewItem.nombresMapa ?? [],
              reviewItem.totalTrazosMapa ?? 0,
              reviewItem.pendientesMapa ?? [],
            );
          }}
          title="Abre el original y resuelve juntos todos los conflictos pendientes de este mapa"
        >
          Resolver conflictos ({pendingForMap.length})
        </button>
      );
    } else if (noItin) {
      primary = (
        <>
          <button
            className="primary compact"
            disabled={!online || !noItin.archivoOriginal || !noItin.trazos.length}
            onClick={() =>
              noItin.archivoOriginal &&
              nav.openReview(lote, noItin.archivoOriginal, noItin.trazos[0].traza, noItin.trazos[0].indice, [], noItin.trazos.length, noItin.trazos, mapId)
            }
            title="Abre el original en el editor: deja sólo los itinerarios (ida y regreso de cada dupla) y guarda; cada dupla va a su carpeta de la ruta"
          >
            Evaluar a mano
          </button>
          <button
            className="danger compact"
            disabled={!online}
            onClick={() => discardMap(mapId, titulo)}
            title="No tiene nada que generar: deja de esperar revisión (se puede deshacer)"
          >
            Descartar mapa
          </button>
        </>
      );
    } else if (status === 'DESCARTADO') {
      primary = (
        <button
          className="compact"
          disabled={!online}
          onClick={() => void call(() => api.decideMap({ lote, mapa: mapId, accion: 'deshacer' }))}
          title="El mapa vuelve a quedar sin itinerarios, esperando revisión"
        >
          Deshacer el descarte
        </button>
      );
    } else if (resolvedForMap.length > 0) {
      primary = (
        <span className="small ok-text">
          <Icon name="check" size={14} /> Resuelto ({resolvedForMap.length})
        </span>
      );
    }
    // deshacer lo resuelto está siempre disponible mientras haya trazos resueltos en el mapa
    if (resolvedForMap.length > 0) more.push(undoResolution);

    return (
      <div className="cc-map-actions">
        {primary}
        {more.length > 0 && (
          <Popover menu className="icon" icon="more" label="" title="Más acciones de este mapa" disabled={!online}>
            {(close) => (
              <div onClick={close} role="presentation">
                {more}
              </div>
            )}
          </Popover>
        )}
      </div>
    );
  };

  return (
    <div className="cc-files">
      <aside className="cc-files-nav">
        <select value={lote} onChange={(e) => (setLote(e.target.value), setRuta(undefined), setSnap(null), setSelectedReviews(new Set()))} aria-label="Lote">
          {state.lotes.map((l) => (
            <option key={l.lote} value={l.lote}>
              {l.lote}
            </option>
          ))}
        </select>
        <button className={!ruta ? 'active' : ''} onClick={() => setRuta(undefined)}>
          Todo el lote
        </button>
        {rutas.map((u) => (
          <button key={u.slug} className={ruta === u.slug ? 'active' : ''} onClick={() => setRuta(u.slug)} title={u.slug}>
            <Badge tone={routeTone(u.estado)}>{ROUTE_LABEL[u.estado]}</Badge> {u.titulo}
          </button>
        ))}
        {rutas.length === 0 && <p className="small muted">Sin rutas: actualiza la fuente de {lote} en Herramientas.</p>}
      </aside>
      <div className="cc-files-main">
        <div className="small muted">
          Carpeta del lote: <code>{snap?.raiz ?? state.lotes.find((l) => l.lote === lote)?.raiz}</code> · originales en <code>originales/</code>, resultados en{' '}
          <code>resultados/</code>
          {loading && ' · actualizando…'}
          {running && (
            <>
              {' '}
              · <span className="cc-spinner" /> en proceso: {running.etapa}
            </>
          )}
        </div>
        {selectedReviews.size > 0 && (
          <div className="row small cc-selection">
            <span>{selectedReviews.size} caso(s) seleccionado(s)</span>
            <button className="danger compact" disabled={!online} onClick={discardSelected}>
              Descartar los seleccionados
            </button>
          </div>
        )}
        {snap?.rutas.map((r) => {
          const routeJob = state.rutas.find((u) => u.lote === lote && u.slug === r.slug)?.jobActivo;
          return (
            <section key={r.slug} className="cc-card">
              <h4>
                {r.titulo}{' '}
                <span className="small muted">
                  resultados/{state.lotes.find((l) => l.lote === lote)?.zona}/{r.carpeta}
                </span>
                {r.mapas.some((m) => m.estado === 'REQUIERE_REVISION') && (
                  <>
                    {' '}
                    <button
                      className="quiet compact"
                      disabled={!online || !!routeJob}
                      onClick={() => reprocess(r.slug)}
                      title="Vuelve a clasificar la ruta con los originales ya descargados (sin red), por si ahora sí se reconocen sus itinerarios; lo ya resuelto a mano se conserva"
                    >
                      <Icon name="refresh" size={14} /> {routeJob ? 'En cola…' : 'Volver a revisar'}
                    </button>
                  </>
                )}
              </h4>
              <table className="cc-table cc-maps">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mapa</th>
                    <th>Estado</th>
                    <th>Qué hacer</th>
                    <th>Original</th>
                    <th>Generados</th>
                  </tr>
                </thead>
                <tbody>
                  {r.mapas.map((m) => {
                    const error = noItinerary.get(m.id)?.motivo ?? m.error;
                    return (
                      <tr key={m.id}>
                        <td>{m.orden}</td>
                        <td>
                          {m.titulo}
                          {error && <div className="small cc-err-text">{error}</div>}
                        </td>
                        <td>
                          <span className="small">{m.estado.toLowerCase().replace(/_/g, ' ')}</span>
                          {live.has(m.id) && (
                            <div>
                              <span className={`cc-badge ${fileTone(live.get(m.id)!)}`}>ahora: {live.get(m.id)}</span>
                            </div>
                          )}
                        </td>
                        <td className="cc-review-actions">{mapActions(m.id, m.titulo, m.estado)}</td>
                        <td>{m.original ? <ul className="cc-files-inline">{fileRow(m.original)}</ul> : <span className="small muted">pendiente</span>}</td>
                        <td>{m.salidas.length ? <ul className="cc-files-inline">{m.salidas.map(fileRow)}</ul> : <span className="small muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
        {!ruta && snap && snap.noRegistrados.length > 0 && (
          <section className="cc-card">
            <h4>En resultados/ pero sin registro del orquestador ({snap.noRegistrados.length})</h4>
            <p className="small muted">Copiados o editados a mano: el orquestador no los sobrescribe ni los da por generados.</p>
            <ul className="cc-files-inline">
              {snap.noRegistrados.slice(0, 50).map((rel) => (
                <li key={rel}>
                  <code>{rel}</code>{' '}
                  <button className="link" onClick={() => nav.openFile(lote, rel)}>
                    Detalles
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!ruta && reviewSnapshot?.resueltas.some((item) => item.resolucion?.estado === 'descartado') && (
          <section className="cc-card">
            <h4>Casos descartados</h4>
            <ul className="cc-files-inline">
              {reviewSnapshot.resueltas
                .filter((item) => item.resolucion?.estado === 'descartado')
                .map((item) => (
                  <li key={item.traza.id}>
                    {item.traza.tituloMapa} · {item.traza.descripcion || item.traza.nombreOriginal}{' '}
                    <button className="link" disabled={!online} onClick={() => resolveReviewAction(item.traza.id, 'deshacer')}>
                      Deshacer el descarte
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {!snap && !loading && <p className="muted">Sin datos todavía.</p>}
      </div>
    </div>
  );
}
