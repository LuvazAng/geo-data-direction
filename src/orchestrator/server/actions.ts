import { ACTION_TYPES, type Action } from '@protocol';
import type { LoteInfo } from '../config';
import { ActionError } from '../errors';
import { describe, type JobManager } from './jobs';

const JOB_ID = /^j[0-9a-z]{6,12}-[0-9a-f]{6}$/;

/** Valida una acción recibida del navegador: tipo permitido, campos con su forma, lote autorizado, ruta/ejecución existentes. */
export function validateAction(
  raw: unknown,
  lotes: LoteInfo[],
  routeExists: (lote: string, ruta: string) => boolean,
  jobExists: (id: string) => boolean,
): Action {
  if (typeof raw !== 'object' || raw === null) throw new ActionError('Acción inválida', 400);
  const r = raw as Record<string, unknown>;
  if (!(ACTION_TYPES as readonly string[]).includes(String(r.tipo))) throw new ActionError(`Acción no permitida: ${String(r.tipo).slice(0, 40)}`, 400);
  const str = (k: string, re: RegExp) => {
    if (typeof r[k] !== 'string' || !re.test(r[k] as string)) throw new ActionError(`Campo inválido: ${k}`, 400);
    return r[k] as string;
  };
  const lote = () => {
    const l = str('lote', /^[\w.-]{1,60}$/);
    if (!lotes.some((x) => x.lote === l)) throw new ActionError(`Lote no autorizado: ${l}`, 400);
    return l;
  };
  const job = () => {
    const id = str('jobId', JOB_ID);
    if (!jobExists(id)) throw new ActionError(`No existe la ejecución ${id}`, 404);
    return id;
  };
  const tipo = r.tipo as Action['tipo'];
  switch (tipo) {
    case 'encolar': {
      const l = lote();
      const ruta = str('ruta', /^[\p{L}\p{N}_.-]{1,120}$/u);
      if (!routeExists(l, ruta)) throw new ActionError(`La ruta ${ruta} no existe en ${l}`, 400);
      return { tipo, lote: l, ruta, primero: r.primero === true, iniciar: r.iniciar === true };
    }
    case 'detalle-ruta': {
      const l = lote();
      const ruta = str('ruta', /^[\p{L}\p{N}_.-]{1,120}$/u);
      if (!routeExists(l, ruta)) throw new ActionError(`La ruta ${ruta} no existe en ${l}`, 400);
      return { tipo, lote: l, ruta };
    }
    case 'encolar-pendientes':
    case 'actualizar-fuente':
      return { tipo, lote: lote() };
    case 'mover-primero':
    case 'iniciar':
    case 'reintentar':
    case 'cancelar':
    case 'detalle-ejecucion':
    case 'explicar-con-pi':
      return { tipo, jobId: job() };
    case 'ejecutar-siguiente':
    case 'pausar':
    case 'reanudar':
      return { tipo };
  }
}

export function actionLabel(a: Action, jobs: JobManager): string {
  const j =
    'jobId' in a
      ? (() => {
          try {
            return describe(jobs.get(a.jobId));
          } catch {
            return a.jobId;
          }
        })()
      : '';
  switch (a.tipo) {
    case 'encolar':
      return `${a.iniciar ? 'Procesar' : a.primero ? 'Poner como siguiente' : 'Encolar'} ${a.lote} · ${a.ruta}`;
    case 'encolar-pendientes':
      return `Encolar las pendientes de ${a.lote}`;
    case 'actualizar-fuente':
      return `Actualizar la fuente de ${a.lote}`;
    case 'detalle-ruta':
      return `Detalles de ${a.lote} · ${a.ruta}`;
    case 'ejecutar-siguiente':
      return 'Procesar la siguiente';
    case 'pausar':
      return 'Pausar la cola';
    case 'reanudar':
      return 'Reanudar la cola';
    case 'mover-primero':
      return `Pasar al frente: ${j}`;
    case 'iniciar':
      return `Iniciar: ${j}`;
    case 'reintentar':
      return `Reintentar: ${j}`;
    case 'cancelar':
      return `Cancelar: ${j}`;
    case 'detalle-ejecucion':
      return `Detalles: ${j}`;
    case 'explicar-con-pi':
      return `Explicar con Pi: ${j}`;
  }
}
