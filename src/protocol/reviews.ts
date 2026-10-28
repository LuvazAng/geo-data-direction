import type { Coord, Relation } from '@core';
import type { TraceRow } from './trace';

// Revisión manual de los trazos que el orquestador no pudo decidir: lo que ve la interfaz y lo que
// se guarda al resolverlos. La lógica que los produce está en el orquestador.

export type ReviewKind = 'propia' | 'alternativa' | 'ampliacion';
export type ReviewAction = 'generar' | 'descartar' | 'deshacer';
export type ReviewDirection = 'directo' | 'inverso' | 'circuito';

export interface ReviewManifestEntry {
  sha256: string;
  tipo: 'resultado' | 'revision';
  traza: string;
  mapa: string;
  fuente: string;
  original: string;
  generadoEn: string;
  resolucionManual?: { tipo: ReviewKind; nombre: string; nota: string; resueltoEn: string };
}

export interface ReviewResolution {
  estado: 'generado' | 'descartado';
  geometriaEditada?: boolean;
  tipo?: ReviewKind;
  nombre?: string;
  nota: string;
  origen?: string;
  destino?: string;
  sentido?: ReviewDirection;
  relacionPrincipal?: string;
  archivoOrigen: string;
  archivoDestino: string;
  archivoRespaldo: string;
  sha256Generado?: string;
  /** Dupla del pipeline con la que se agrupó (comparte su carpeta); las resoluciones antiguas no la traen. */
  dupla?: number;
  /** Dupla (1, 2…) elegida al evaluar a mano un mapa sin itinerarios; con ella se numera su carpeta. */
  grupoMapa?: number;
  /** Ausente si el trazo no tenía archivo de revisión (mapa evaluado a mano). */
  manifiesto?: ReviewManifestEntry;
  resueltoEn: string;
}

/** Decisión sobre un mapa completo que no tiene itinerarios. */
export interface MapDecision {
  estado: 'descartado';
  nota: string;
  resueltoEn: string;
}

export interface ReviewAlternative {
  traza: string;
  titulo: string;
  descripcion: string;
  coords: Coord[];
  relacion: {
    tipo: Relation['kind'];
    texto: string;
    invertir: boolean;
    cobertura: number;
    distanciaM: number;
    verticeSalida?: number;
    verticeRegreso?: number;
    coordSalida?: Coord;
    coordRegreso?: Coord;
    sePuedeUnir: boolean;
  };
}

export interface ReviewItem {
  traza: TraceRow;
  archivo: string | null;
  archivoOriginal?: string | null;
  totalTrazosMapa?: number;
  nombresMapa?: { indice: number; nombre: string }[];
  pendientesMapa?: { traza: string; indice: number; nombre?: string }[];
  preview?: { coords: Coord[]; relacionadas: ReviewAlternative[]; error?: string };
  resolucion?: ReviewResolution;
}

/** Mapa sin itinerarios utilizables y sin decisión: se puede evaluar a mano o descartar. */
export interface MapWithoutItineraries {
  mapa: string;
  motivo: string;
  archivoOriginal: string | null;
  trazos: { traza: string; indice: number }[];
}

export interface ReviewSnapshot {
  pendientes: ReviewItem[];
  resueltas: ReviewItem[];
  sinItinerarios: MapWithoutItineraries[];
  mapasDescartados: ({ mapa: string } & MapDecision)[];
}
