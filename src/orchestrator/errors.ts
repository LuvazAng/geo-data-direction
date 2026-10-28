/** Una acción que no se puede hacer (con el estado HTTP con que el servidor la responde). */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/** Falta un dato que el orquestador no trae consigo (el mensaje dice cuál y cómo conseguirlo). */
export class MissingDataError extends Error {}
