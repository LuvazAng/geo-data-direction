import type { ColoniasRuta } from '@core';
import type { SiglasResponse, SiglasSource } from '@protocol';
import type { SnapResult } from '../services/snap';
import type { NameReport, NameSubject } from '../state/naming';

/** Colonias por las que pasa el trazo (sólo del seleccionado). */
export type ColoniasView = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; result: ColoniasRuta };

/** Ajuste a calles en vista previa para este trazo. */
export type SnapView = { maxDist: number } &
  /** `progress` no llega mientras espera a que termine otra descarga. */
  ({ state: 'loading'; since: number; progress?: { done: number; total: number } } | { state: 'error'; message: string } | { state: 'ok'; result: SnapResult });

/** Lo que el servidor respondió sobre las siglas de las colonias, o en qué va. */
export type NameAnswer = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; response: SiglasResponse };

/** Una colonia del nombre con las siglas que lleva ahora. */
export interface NamePlace {
  nombre: string;
  /** Tipo y municipio, para distinguirla de otra con el mismo nombre. */
  detalle: string;
  siglas: string;
  /** De dónde salen; `manual` si se corrigieron a mano. */
  fuente: SiglasSource | 'manual';
  nota?: string;
}

/** El asistente de nombres abierto en un trazo: sus siglas y, por cada trazo de la dupla, la comparación de nombres. */
export interface NameView {
  answer: NameAnswer;
  /** Código de la ruta (R6O). */
  ruta: string;
  lugares: NamePlace[];
  trazos: { subject: NameSubject; report: NameReport | null }[];
}

export interface NameActions {
  close: () => void;
  retry: () => void;
  setRuta: (codigo: string) => void;
  setSiglas: (lugar: string, siglas: string) => void;
  /** Le pone ese nombre al trazo. */
  use: (id: string, nombre: string) => void;
  /** Le pone la propuesta a cada trazo de la dupla que tenga una. */
  useAll: () => void;
}

/** Herramienta de forma abierta en el inspector (una a la vez). */
export type ShapeToolId = 'edit' | 'simplify' | 'snap';

export interface RouteActions {
  select: () => void;
  invert: () => void;
  toggle: () => void;
  zoom: () => void;
  rename: (name: string) => void;
  setFolder: (folder: string) => void;
  save: () => void;
  retryOneways: () => void;
  simplify: (toleranceM: number) => void;
  simplifyClose: () => void;
  snapDistance: (m: number) => void;
  snapApply: () => void;
  snapCancel: () => void;
  toggleEdit: () => void;
  undo: () => void;
  restore: () => void;
  /** Abre el asistente de nombres; sólo existe al resolver un mapa desde el centro de control. */
  suggestName?: () => void;
  /** Quita el trazo de la lista (no borra el archivo del disco). */
  remove: () => void;
}
