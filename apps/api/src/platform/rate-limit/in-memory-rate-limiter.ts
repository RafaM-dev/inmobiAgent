import type { Clock } from "../clock/clock";
import type { Logger } from "../logging/logger";
import { unlimited, type RateLimiter } from "./rate-limiter";
import {
  consume,
  fullAgainAtMs,
  fullBucket,
  isQuotaActive,
  type BucketState,
  type Quota,
  type RateLimitDecision,
} from "./token-bucket";

/**
 * Limitador de ritmo en memoria del proceso.
 *
 * **Decisión (D58): en memoria, no en Postgres, y a sabiendas de lo que cuesta.**
 *
 * Con N réplicas el límite efectivo es N veces el configurado, porque cada
 * proceso lleva su propia cuenta. Eso sería inaceptable para el tope de gasto
 * —donde el número tiene que cuadrar con una factura— y por eso ese vive en la
 * base de datos, en una sentencia atómica. Aquí no lo es, por tres razones:
 *
 *  1. Lo que se protege es el ORDEN DE MAGNITUD. La diferencia entre cortar un
 *     bucle a los 120 mensajes por minuto o a los 360 no cambia nada; la
 *     diferencia entre cortarlo y no cortarlo, todo.
 *  2. El límite se comprueba en el camino más caliente que existe: cada mensaje
 *     entrante. Llevarlo a Postgres convertiría cada mensaje en una ESCRITURA
 *     adicional, y el mecanismo que debía proteger la base sería la carga que
 *     la tumba.
 *  3. Un limitador en memoria sigue funcionando cuando la base de datos está
 *     ahogada, que es justo el momento en el que hace falta.
 *
 * Cuando haya varias réplicas de verdad, el reemplazo es un adaptador de Redis
 * detrás de este mismo puerto: el algoritmo ya es una función pura reutilizable
 * tal cual, y nadie más se entera.
 */

interface Entry {
  state: BucketState;
  /** Instante en que el cubo vuelve a estar lleno; a partir de ahí es basura. */
  fullAtMs: number;
}

/** Cada cuánto se barren las claves inactivas, como mucho. */
const SWEEP_EVERY_MS = 60_000;

/**
 * Claves a partir de las cuales se fuerza un barrido.
 *
 * Diez mil cubos son unos pocos cientos de kilobytes: el tope no está para
 * ahorrar memoria, sino para que una avalancha de claves distintas —cada
 * mensaje con un contacto nuevo— no se convierta en una fuga silenciosa.
 */
const MAX_KEYS = 10_000;

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Entry>();
  private nextSweepAtMs = 0;

  constructor(
    private readonly deps: {
      clock: Clock;
      logger: Logger;
    },
  ) {}

  consume(input: { key: string; quota: Quota; cost?: number }): Promise<RateLimitDecision> {
    return Promise.resolve(this.decide(input));
  }

  /** Claves vivas. Solo para los tests y para métricas futuras. */
  get size(): number {
    return this.buckets.size;
  }

  private decide(input: { key: string; quota: Quota; cost?: number }): RateLimitDecision {
    const { key, quota } = input;
    if (!isQuotaActive(quota)) return unlimited();

    const nowMs = this.deps.clock.nowMs();
    this.sweepIfDue(nowMs);

    const existing = this.buckets.get(key);
    const state = existing?.state ?? fullBucket(quota, nowMs);

    const outcome = consume({
      state,
      quota,
      nowMs,
      ...(input.cost === undefined ? {} : { cost: input.cost }),
    });

    this.buckets.set(key, {
      state: outcome.state,
      fullAtMs: fullAgainAtMs(outcome.state, quota, nowMs),
    });

    return outcome.decision;
  }

  /**
   * Tira las claves cuyo cubo ya volvió a estar lleno.
   *
   * Un cubo lleno no guarda ninguna información: borrarlo y volver a crearlo
   * lleno da exactamente el mismo resultado. Por eso la limpieza no puede
   * cambiar ninguna decisión, y por eso puede ser perezosa.
   */
  private sweepIfDue(nowMs: number): void {
    if (nowMs < this.nextSweepAtMs && this.buckets.size < MAX_KEYS) return;
    this.nextSweepAtMs = nowMs + SWEEP_EVERY_MS;

    for (const [key, entry] of this.buckets) {
      if (entry.fullAtMs <= nowMs) this.buckets.delete(key);
    }

    if (this.buckets.size >= MAX_KEYS) {
      // Nada que barrer y aun así por encima del tope: no es una fuga, es
      // tráfico. Se avisa porque suele significar que alguien está probando el
      // sistema con miles de identidades distintas.
      this.deps.logger.warn("El limitador de ritmo sigue lleno tras barrer", {
        keys: this.buckets.size,
      });
    }
  }
}
