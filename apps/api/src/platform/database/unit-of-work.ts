/**
 * Unidad de trabajo.
 *
 * Los casos de uso declaran "esto es atómico" sin saber qué motor hay debajo.
 * Ejemplo canónico: registrar un lead Y encolar `lead.captured` en el outbox
 * deben ocurrir juntos o no ocurrir.
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Implementación trivial para tests y adaptadores en memoria. */
export class NoopUnitOfWork implements UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
