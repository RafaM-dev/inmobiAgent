import type { Quota, RateLimitDecision } from "./token-bucket";

/**
 * PUERTO `RateLimiter` — cuánto ritmo se le tolera a una clave.
 *
 * La clave la construye quien llama y describe el ÁMBITO del límite:
 * `messages:{tenantId}` acota lo que entra por los canales de una inmobiliaria,
 * `turns:{tenantId}:{contactId}` acota lo que un contacto le hace gastar al
 * agente. El limitador no interpreta la clave; solo cuenta.
 *
 * **Es asíncrono aunque la implementación de hoy no lo necesite.** La de hoy es
 * un mapa en memoria y podría ser síncrona, pero la de mañana es Redis y no
 * puede. Un puerto síncrono obligaría a tocar todos los sitios que lo llaman el
 * día que haya más de una réplica, que es exactamente cuando nadie quiere tocar
 * nada.
 */
export interface RateLimiter {
  /**
   * Intenta gastar `cost` fichas de `key`.
   *
   * Nunca lanza. Un limitador que revienta convierte una protección en una
   * caída, y la respuesta correcta cuando no se puede medir el ritmo es dejar
   * pasar y avisar en el log — igual que con el contador de gasto.
   */
  consume(input: {
    key: string;
    quota: Quota;
    /** Fichas que cuesta la operación. Por defecto, una. */
    cost?: number;
  }): Promise<RateLimitDecision>;
}

/** Decisión de "sin límite": lo que devuelve una cuota inactiva. */
export const unlimited = (): RateLimitDecision => ({
  allowed: true,
  remaining: Number.MAX_SAFE_INTEGER,
  retryAfterMs: 0,
});
