/**
 * Result<T, E> — errores esperados como valores, no como excepciones.
 *
 * Motivo: en un agente conversacional, "no encontré inmuebles", "el proveedor
 * tardó demasiado" o "faltan datos del cliente" NO son fallos del programa: son
 * resultados válidos que el agente debe explicar al usuario. Modelarlos como
 * excepciones haría que el compilador no nos obligue a tratarlos.
 *
 * Las excepciones quedan reservadas para bugs y fallos irrecuperables.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** `ok()` sin valor, para casos de uso que solo producen efectos. */
export const okVoid = (): Ok<void> => ({ ok: true, value: undefined });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Transforma el valor de éxito y deja el error intacto. */
export const map = <T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  r.ok ? ok(fn(r.value)) : r;

/** Transforma el error y deja el valor intacto. */
export const mapErr = <T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(fn(r.error));

/** Encadena operaciones que a su vez devuelven Result (railway oriented). */
export const andThen = <T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.value) : r);

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback);

/**
 * Colapsa una lista de Result en un Result de lista. Falla con el primer error.
 * Útil al validar varios campos o al ejecutar varias tools.
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
};

/**
 * Envuelve código que puede lanzar (SDKs de terceros, JSON.parse) y lo
 * convierte a Result. Es la frontera entre "mundo que lanza" y nuestro dominio.
 */
export const fromThrowable = async <T, E>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onError(cause));
  }
};
