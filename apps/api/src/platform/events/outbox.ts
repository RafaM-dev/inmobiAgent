import type { Clock } from "../clock/clock";
import type { Logger } from "../logging/logger";
import type { AppMetrics } from "../telemetry/app-metrics";
import type { EventBus } from "./event-bus";
import type { EventEnvelope } from "./event";

/**
 * Patrón Outbox transaccional.
 *
 * Problema que resuelve: si guardamos el lead en la base y luego publicamos
 * `lead.captured`, un crash entre ambas operaciones pierde el evento y el
 * asesor nunca se entera. Si publicamos primero y la transacción falla,
 * notificamos un lead que no existe.
 *
 * Solución: el evento se escribe en `outbox_events` DENTRO de la misma
 * transacción que el cambio de estado. Un relay lo publica después. La entrega
 * pasa a ser "al menos una vez", que es exactamente lo que los consumidores
 * idempotentes saben tolerar.
 *
 * Es también la pieza que hace indolora la migración a microservicios: el día
 * que el relay publique a Redis o SQS, nadie más se entera.
 */

export interface OutboxRecord {
  readonly id: string;
  readonly envelope: EventEnvelope;
  readonly attempts: number;
  readonly availableAt: Date;
}

export interface OutboxStore {
  /**
   * Encola un evento. Se une automáticamente a la transacción ambiental si la
   * hay (ver `UnitOfWork`): por eso la firma no arrastra un `tx` por medio
   * sistema, y por eso platform no necesita conocer Prisma.
   */
  enqueue(envelope: EventEnvelope): Promise<void>;

  /** Reserva un lote de eventos pendientes (SELECT … FOR UPDATE SKIP LOCKED). */
  reserveBatch(limit: number, now: Date): Promise<OutboxRecord[]>;

  markPublished(ids: readonly string[], publishedAt: Date): Promise<void>;

  /** Reprograma con backoff exponencial. Tras `maxAttempts` va a dead-letter. */
  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;

  markDeadLettered(id: string, error: string): Promise<void>;
}

export interface OutboxRelayOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
}

/**
 * Relay: mueve eventos del outbox al bus. Corre en el proceso worker.
 *
 * Se apoya en `SKIP LOCKED` en el store, así varias réplicas pueden correr en
 * paralelo sin duplicar trabajo ni bloquearse entre sí.
 */
export class OutboxRelay {
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;

  constructor(
    private readonly deps: {
      store: OutboxStore;
      bus: EventBus;
      clock: Clock;
      logger: Logger;
      metrics: AppMetrics;
    },
    options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.deps.logger.info("OutboxRelay iniciado", {
      batchSize: this.batchSize,
      pollIntervalMs: this.pollIntervalMs,
    });
    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await Promise.resolve();
    this.deps.logger.info("OutboxRelay detenido");
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /** Un ciclo. Expuesto para poder testearlo sin temporizadores. */
  async tick(): Promise<number> {
    let processed = 0;
    try {
      const batch = await this.deps.store.reserveBatch(this.batchSize, this.deps.clock.now());
      for (const record of batch) {
        processed += (await this.deliver(record)) ? 1 : 0;
      }
    } catch (error) {
      this.deps.logger.error("Fallo en el ciclo del OutboxRelay", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
    // Si el lote venía lleno, probablemente hay más: no esperamos.
    this.scheduleNext(processed >= this.batchSize ? 0 : this.pollIntervalMs);
    return processed;
  }

  private async deliver(record: OutboxRecord): Promise<boolean> {
    const event = record.envelope.type;

    try {
      await this.deps.bus.publishEnvelope(record.envelope);
      await this.deps.store.markPublished([record.id], this.deps.clock.now());

      this.deps.metrics.outboxDelivered.inc({ event });
      /*
       * El retraso se mide desde que el evento se ENCOLÓ, no desde que se
       * reservó. Es la única forma de ver la espera real: un evento que estuvo
       * cuatro minutos en la cola y se entrega en dos milisegundos no es una
       * entrega rápida, es una cola que no da abasto.
       */
      this.deps.metrics.outboxLag.observe(
        Math.max(0, this.deps.clock.nowMs() - record.envelope.occurredAt.getTime()) / 1000,
        { event },
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = record.attempts + 1;

      if (attempts >= this.maxAttempts) {
        this.deps.metrics.outboxDeadLettered.inc({ event });
        await this.deps.store.markDeadLettered(record.id, message);
        this.deps.logger.error("Evento enviado a dead-letter", {
          eventId: record.envelope.eventId,
          eventType: record.envelope.type,
          attempts,
          err: message,
        });
        return false;
      }

      // Backoff exponencial con jitter para no sincronizar réplicas.
      const backoff = this.baseBackoffMs * 2 ** record.attempts;
      const jitter = Math.floor(Math.random() * this.baseBackoffMs);
      const nextAttemptAt = new Date(this.deps.clock.nowMs() + backoff + jitter);

      this.deps.metrics.outboxRetried.inc({ event });
      await this.deps.store.markFailed(record.id, message, nextAttemptAt);
      this.deps.logger.warn("Reintento programado para evento del outbox", {
        eventId: record.envelope.eventId,
        attempts,
        nextAttemptAt: nextAttemptAt.toISOString(),
      });
      return false;
    }
  }
}
