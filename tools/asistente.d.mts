// Tipos de asistente.mjs (el archivo es JavaScript para correr antes de `npm install`).

export const OLLAMA_DESCARGA: string;
export const OLLAMA_LINUX: string;

export interface Entorno {
  plataforma: string;
  modeloNombre: string;
  ollama: boolean;
  modelo: boolean;
  winget: boolean;
  brew: boolean;
  coloniasGeojson: boolean;
  datosConfigurados: boolean;
  datosActual: string;
}

export interface Respuestas {
  ia: boolean;
  colonias: boolean;
  datos: string | null;
}

export type Comando = [string, string[]];

export type Accion =
  | { tipo: 'guardar-datos'; ruta: string }
  | { tipo: 'instalar-ollama'; comando: Comando; texto: string }
  | { tipo: 'mostrar-instalacion-ollama'; texto: string }
  | { tipo: 'descargar-modelo'; modelo: string }
  | { tipo: 'colonias' };

export interface Opciones {
  interactivo: boolean;
  sinAsistente: boolean;
  configurar: boolean;
}

export interface EstadoAsistente {
  version: number;
  fecha: string;
  preguntas: string[];
  respuestas: Respuestas;
  hecho: string[];
}

export interface EntradaEjecutar {
  env: NodeJS.ProcessEnv;
  envArchivo: string;
  log: (mensaje: string) => void;
  run: (comando: string, argumentos: string[]) => Promise<number>;
  ollama: () => string | null;
  ollamaListo: () => Promise<boolean>;
  colonias: () => Promise<number>;
}

export function motivoNoPregunta(o: Partial<Opciones> & { estado: unknown }): 'sin-asistente' | 'sin-terminal' | 'ya-configurado' | null;
export function preguntasPara(entorno: Entorno, opciones?: { configurar?: boolean }): ('ia' | 'colonias' | 'datos')[];
export function comandoOllama(entorno: Pick<Entorno, 'plataforma' | 'winget' | 'brew'>): { comando: Comando | null; texto: string };
export function accionesPara(respuestas: Respuestas, entorno: Entorno): Accion[];
export function esSi(texto: string): boolean;
export function preguntar(
  ids: string[],
  entorno: Entorno,
  io: { ask: (pregunta: string) => Promise<string> | string; log: (linea: string) => void },
): Promise<Respuestas>;
export function leerEstado(archivo: string): EstadoAsistente | null;
export function guardarEstado(archivo: string, estado: unknown): void;
export function actualizarEnv(archivo: string, clave: string, valor: string): void;
export function buscarComando(nombre: string, plataforma?: string): string | null;
export function buscarOllama(env?: NodeJS.ProcessEnv, plataforma?: string): string | null;
export function modeloInstalado(modelo: string, env?: NodeJS.ProcessEnv, casa?: string): boolean;
export function detectarEntorno(o: { root: string; env?: NodeJS.ProcessEnv; plataforma?: string; modelo: string }): Entorno;
export function ejecutar(acciones: Accion[], io: EntradaEjecutar): Promise<string[]>;
export function asistente(o: {
  opciones: Opciones;
  entorno: Entorno;
  estadoArchivo: string;
  ask: (pregunta: string) => Promise<string> | string;
  log: (linea: string) => void;
  io: EntradaEjecutar;
}): Promise<'sin-asistente' | 'sin-terminal' | 'ya-configurado' | null>;
