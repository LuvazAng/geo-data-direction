import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_SIGLAS, type ColoniaIndex } from '@core';
import type { NameAnswer, NameActions, NameView } from '../routes/types';
import type { Route } from '../services/route';
import { nameGroup, placesToAbbreviate, reportsFor, subjectOf } from '../state/naming';
import type { ReviewEditor } from '../state/review';
import type { PatchRoute } from '../state/routes';
import type { Notify } from './useNotice';
import type { ReviewServer } from './useReview';

interface Session {
  /** El trazo desde el que se abrió: el asistente sólo sigue abierto mientras siga seleccionado. */
  routeId: string;
  answer: NameAnswer;
  /** Código de la ruta corregido a mano. */
  ruta: string;
  /** Siglas corregidas a mano, por colonia. */
  edits: Record<string, string>;
}

interface Deps {
  reviewEditor: ReviewEditor | null;
  routes: Route[];
  selectedId: string | null;
  duplaOf: Record<string, number | undefined>;
  index: ColoniaIndex | undefined;
  patchRoute: PatchRoute;
  notify: Notify;
  server: Pick<ReviewServer, 'suggestSiglas'>;
}

const NO_COLONIA = 'El inicio y el final del trazo no caen en ninguna colonia, así que no hay de dónde sacar el nombre.';

/**
 * Asistente de nombres al resolver un mapa a mano: pide al servidor las siglas de las colonias donde empieza y termina el
 * trazo (y su dupla) y deja ver, antes de aplicarlo, cómo se compara el nombre original con el propuesto.
 */
export function useNameSuggestions({ reviewEditor, routes, selectedId, duplaOf, index, patchRoute, notify, server }: Deps) {
  const [session, setSession] = useState<Session | null>(null);
  /** Número de la última petición: una respuesta que llega tarde (otro trazo, otro intento) se descarta. */
  const ticket = useRef(0);

  const close = useCallback(() => {
    ticket.current += 1;
    setSession(null);
  }, []);

  const start = useCallback(
    async (routeId: string) => {
      if (!reviewEditor || !index) return;
      const byId = new Map(routes.map((r) => [r.id, r]));
      const group = nameGroup(routeId, routes, duplaOf).flatMap((id) => byId.get(id) ?? []);
      const lugares = placesToAbbreviate(group.map((r) => subjectOf(r, index)));
      // la ruta de los lugares se sabe por un trazo pendiente del mapa: el del propio trazo o, si no lo es, el primero
      const pending = group.flatMap((r) => reviewEditor.pendientes.filter((p) => p.indice === r.parsed.index))[0] ?? reviewEditor.pendientes[0];
      const mine = ++ticket.current;
      const fresh = (answer: NameAnswer): Session => ({ routeId, answer, ruta: '', edits: {} });
      if (!pending || lugares.length === 0) {
        setSession(fresh({ state: 'error', message: pending ? NO_COLONIA : 'Este mapa no tiene trazos pendientes de los que tomar la ruta.' }));
        return;
      }
      setSession(fresh({ state: 'loading' }));
      let answer: NameAnswer;
      try {
        answer = { state: 'ok', response: await server.suggestSiglas({ lote: reviewEditor.lote, traza: pending.traza, lugares }) };
      } catch (e) {
        answer = { state: 'error', message: (e as Error).message };
      }
      if (mine === ticket.current) setSession((s) => (s && s.routeId === routeId ? { ...s, answer } : s));
    },
    [reviewEditor, index, routes, duplaOf, server],
  );

  // se cierra al cambiar de trazo o al terminar la revisión
  useEffect(() => {
    if (session && (session.routeId !== selectedId || !reviewEditor)) close();
  }, [session, selectedId, reviewEditor, close]);

  const view = useMemo<NameView | null>(() => {
    if (!session || !index) return null;
    const byId = new Map(routes.map((r) => [r.id, r]));
    const subjects = nameGroup(session.routeId, routes, duplaOf)
      .flatMap((id) => byId.get(id) ?? [])
      .map((r) => subjectOf(r, index));
    const response = session.answer.state === 'ok' ? session.answer.response : null;
    const ruta = session.ruta || response?.ruta.codigo || '';
    const fromServer = (lugar: string) => response?.lugares.find((l) => l.nombre === lugar);
    const siglas = (lugar: string) => session.edits[lugar] ?? fromServer(lugar)?.siglas ?? '';
    const reports = response ? reportsFor(subjects, Object.fromEntries(routes.map((r) => [r.id, r.outName])), ruta, siglas) : new Map();
    return {
      answer: session.answer,
      ruta,
      lugares: placesToAbbreviate(subjects).map((p) => ({
        nombre: p.nombre,
        detalle: [p.tipo, p.municipio].filter(Boolean).join(' · '),
        siglas: siglas(p.nombre),
        fuente: p.nombre in session.edits ? 'manual' : (fromServer(p.nombre)?.fuente ?? 'regla'),
        nota: p.nombre in session.edits ? undefined : fromServer(p.nombre)?.nota,
      })),
      trazos: subjects.map((subject) => ({ subject, report: reports.get(subject.id) ?? null })),
    };
  }, [session, routes, duplaOf, index]);

  const use = useCallback((id: string, outName: string) => patchRoute(id, { outName, saved: undefined }), [patchRoute]);

  const on: NameActions = {
    close,
    retry: () => session && void start(session.routeId),
    setRuta: (codigo) => setSession((s) => s && { ...s, ruta: codigo.toUpperCase().replace(/[^A-Z0-9_]/g, '') }),
    setSiglas: (lugar, value) =>
      setSession(
        (s) =>
          s && {
            ...s,
            edits: {
              ...s.edits,
              [lugar]: value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, MAX_SIGLAS),
            },
          },
      ),
    use,
    useAll: () => {
      const proposals = (view?.trazos ?? []).flatMap((t) => (t.report?.propuesta ? [[t.subject.id, t.report.propuesta] as const] : []));
      if (proposals.length === 0) return notify('Todavía no hay una propuesta que aplicar: revisa las siglas de las colonias.', 'error');
      for (const [id, name] of proposals) use(id, name);
    },
  };

  const open = () => {
    if (selectedId) void start(selectedId);
  };

  return { view, on, open };
}
