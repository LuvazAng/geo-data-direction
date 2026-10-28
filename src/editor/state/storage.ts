// Carpetas que ya se terminaron de revisar, recordadas en el navegador entre sesiones.

export const DONE_KEY = 'geo-direction:done:v1';

export type Done = Record<string, boolean>;

export function loadDone(storage: Pick<Storage, 'getItem'> = localStorage): Done {
  try {
    return JSON.parse(storage.getItem(DONE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveDone(done: Done, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(DONE_KEY, JSON.stringify(done));
  } catch {
    /* ignorar */
  }
}
