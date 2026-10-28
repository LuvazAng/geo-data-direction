import type { Coord } from '@core';

// Fila de la tabla de trazos del reporte del orquestador (una por trazo de cada mapa) y los tipos
// que la describen. La arma el orquestador y la muestra la interfaz.

export type Role = 'principal' | 'tramo' | 'ampliacion' | 'base' | 'otro';
export type Sentido = 'confirmado' | 'inferido' | 'contrario' | 'contradictorio' | 'sin-evidencia' | 'circuito' | 'no-aplica';

export interface Evidence {
  fuente: 'localidad' | 'municipio' | 'terminal' | 'dupla' | 'titulo' | 'ia' | 'geometria' | 'existente';
  detalle: string;
  /** > 0 apoya que el archivo va de ORIGEN a DESTINO; < 0 lo contradice; 0 informativa. */
  peso: number;
}

export type CodeSource = 'config' | 'aprendido' | 'regla' | 'sugerido';

export interface TraceRow {
  id: string;
  ruta: string;
  mapa: string;
  mapaAsignado: string;
  tituloMapa: string;
  orden: number;
  indice: number;
  nombreOriginal: string;
  descripcion: string;
  autoAmpl: string;
  oid: string;
  rol: Role;
  longitudKm: number;
  origen: string | null;
  destino: string | null;
  via: string | null;
  variante: string;
  fuenteNombres: string | null;
  inicio: { coord: Coord; localidad: string | null; distanciaM: number | null; municipio: string | null };
  final: { coord: Coord; localidad: string | null; distanciaM: number | null; municipio: string | null };
  sentido: Sentido;
  puntaje: number;
  evidencias: Evidence[];
  dupla: number | null;
  duplaN?: number;
  similitudDupla: { clase: string; similitud: number; sentido: string } | null;
  nombreFinal: string | null;
  nombrePropuesto: string | null;
  codigos: Record<string, CodeSource | null> | null;
  metodo: string;
  estado: 'GENERADO' | 'REQUIERE_REVISION' | 'NO_SE_GENERA';
  motivosRevision: string[];
  duplicadoDe: string | null;
  relacion: { principal: string; tipo: string; invertir: boolean; cobertura: number } | null;
  anomalias: string[];
  archivo: string | null;
  /**
   * `dupla`: dupla del pipeline con la que se agrupó al resolverse (comparte su carpeta).
   * `grupoMapa`: dupla (1, 2…) que eligió el usuario al evaluar a mano un mapa sin itinerarios.
   */
  resolucionManual?: {
    estado: 'generado' | 'descartado';
    tipo?: 'propia' | 'ampliacion' | 'alternativa';
    nota: string;
    resueltoEn: string;
    dupla?: number;
    grupoMapa?: number;
  };
}
