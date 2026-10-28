import type { CodeSource } from './trace';

// Siglas de los lugares para los nombres de archivo (R6O-12OCT-TLARG): lo que el editor le pide al servidor y lo que éste
// responde. Armar el nombre y evaluarlo es de `@core`; aquí sólo viaja qué siglas lleva cada lugar.

/** Un lugar (una colonia) al que hay que ponerle siglas. */
export interface PlaceToAbbreviate {
  nombre: string;
  /** Colonia, Barrio, Fraccionamiento… */
  tipo?: string;
  municipio?: string;
}

export interface SiglasRequest {
  lote: string;
  /** Un trazo pendiente de la revisión: de él se sabe a qué ruta pertenecen los lugares. */
  traza: string;
  lugares: PlaceToAbbreviate[];
}

/** De dónde salió el código: el catálogo (`config`, `aprendido`, `sugerido`), Qwen o la regla de respaldo. */
export type SiglasSource = CodeSource | 'qwen';

export interface SiglasResult {
  nombre: string;
  siglas: string;
  fuente: SiglasSource;
  /** Por qué se usó otra cosa que la primera opción (p. ej. Qwen no estaba disponible). */
  nota?: string;
}

export interface SiglasResponse {
  /** Código de la ruta (R6O) y de dónde sale. */
  ruta: { codigo: string; fuente: CodeSource };
  lugares: SiglasResult[];
  ia: {
    habilitada: boolean;
    usada: boolean;
    modelo?: string;
    ms?: number;
    error?: string;
    /** Lo que propuso Qwen y se descartó, con el motivo. */
    descartes: string[];
  };
}
