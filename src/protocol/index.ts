// Contrato entre el servidor del centro de control (Node) y su interfaz (navegador): eventos del
// orquestador, mensajes y estado del centro. Sólo tipos y constantes, sin dependencias de Node.
// Lo importan las dos partes con '@protocol'.
export * from './events';
export * from './centro';
export * from './reviews';
export * from './nombres';
export * from './trace';
