import type { Clock } from "../clock/clock";
import type { IdGenerator } from "../ids/id-generator";
import type { Logger } from "../logging/logger";
import { TenantContext } from "../tenancy/tenant-context";
import type {
  EventDefinition,
  EventEnvelope,
  EventSubscription,
  PublishOptions,
} from "./event";
import { createEnvelope } from "./envelope";

/**
 * Puerto del bus de eventos.
 *
 * Hoy la implementación es en proceso. Mañana será Redis Streams o SQS: los
 * publicadores y consumidores no cambian, solo el registro en el contenedor.
 */
export interface EventBus {
  publish<TPayload>(
    event: EventDefinition<TPayload>,
    payload: TPayload,
    options?: PublishOptions,
  ): Promise<void>;

  publishEnvelope(envelope: EventEnvelope): Promise<void>;

  subscribe<TPayload>(subscription: EventSubscription<TPayload>): void;
}

/** Marca eventos ya procesados por un handler concreto (tabla `inbox_events`). */
export interface IdempotencyStore {
  /** `true` si es la primera vez que este handler ve este evento. */
  claim(eventId: string, handlerName: string): Promise<boolean>;
  release(eventId: string, handlerName: string): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  claim(eventId: string, handlerName: string): Promise<boolean> {
    const key = `${eventId}::${handlerName}`;
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    return Promise.resolve(true);
  }

  release(eventId: string, handlerName: string): Promise<void> {
    this.seen.delete(`${eventId}::${handlerName}`);
    return Promise.resolve();
  }
}

/**
 * Bus en proceso.
 *
 * Decisiones deliberadas:
 *  - Los handlers se ejecutan AISLADOS: si uno falla, los demás siguen. Un fallo
 *    al notificar a un asesor no puede impedir que el lead se registre.
 *  - La entrega es "al menos una vez": el handler que falla se reintenta desde
 *    el outbox, por eso `claim` se libera al fallar.
 *  - Publicar nunca lanza hacia el emisor: quien publicó ya hizo commit.
 */
export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Map<string, EventSubscription[]>();

  constructor(
    private readonly deps: {
      logger: Logger;
      clock: Clock;
      ids: IdGenerator;
      idempotency: IdempotencyStore;
    },
  ) {}

  subscribe<TPayload>(sub: EventSubscription<TPayload>): void {
    const list = this.subscriptions.get(sub.event.type) ?? [];
    if (list.some((s) => s.name === sub.name)) {
      throw new Error(
        `Suscripción duplicada "${sub.name}" para el evento "${sub.event.type}". ` +
          "Los nombres de handler deben ser únicos: son la clave de idempotencia.",
      );
    }
    list.push(sub as EventSubscription);
    this.subscriptions.set(sub.event.type, list);
  }

  async publish<TPayload>(
    event: EventDefinition<TPayload>,
    payload: TPayload,
    options: PublishOptions = {},
  ): Promise<void> {
    await this.publishEnvelope(createEnvelope(event, payload, options, this.deps));
  }

  async publishEnvelope(envelope: EventEnvelope): Promise<void> {
    const handlers = this.subscriptions.get(envelope.type) ?? [];
    if (handlers.length === 0) {
      this.deps.logger.debug("Evento sin consumidores", {
        eventType: envelope.type,
        eventId: envelope.eventId,
      });
      return;
    }

    await Promise.all(handlers.map((handler) => this.dispatch(handler, envelope)));
  }

  private async dispatch(sub: EventSubscription, envelope: EventEnvelope): Promise<void> {
    const isFirstDelivery = await this.deps.idempotency.claim(envelope.eventId, sub.name);
    if (!isFirstDelivery) {
      this.deps.logger.debug("Evento ya procesado, se ignora", {
        handler: sub.name,
        eventId: envelope.eventId,
      });
      return;
    }

    const startedAt = this.deps.clock.nowMs();
    try {
      // El contexto se restablece desde el sobre: un handler nunca corre sin
      // tenant. Si esto se dejara a cada consumidor, tarde o temprano uno lo
      // olvidaría y leería datos de otra inmobiliaria.
      await TenantContext.run(
        {
          tenantId: envelope.tenantId,
          correlationId: envelope.correlationId,
          source: "job",
        },
        async () => sub.handle(envelope),
      );
      this.deps.logger.debug("Evento procesado", {
        handler: sub.name,
        eventType: envelope.type,
        durationMs: this.deps.clock.nowMs() - startedAt,
      });
    } catch (error) {
      // Se libera el claim para que el reintento del outbox pueda reprocesarlo.
      await this.deps.idempotency.release(envelope.eventId, sub.name);
      this.deps.logger.error("Fallo al procesar evento", {
        handler: sub.name,
        eventType: envelope.type,
        eventId: envelope.eventId,
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    }
  }
}
