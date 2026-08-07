import type { Clock } from "../clock/clock";
import type { IdGenerator } from "../ids/id-generator";
import type { EventDefinition, PublishOptions } from "./event";
import { createEnvelope } from "./envelope";
import type { OutboxStore } from "./outbox";

/**
 * Puerto de EMISIÓN de eventos.
 *
 * Separado de `EventBus` (que es el lado de ENTREGA) a propósito: los casos de
 * uso solo deben poder publicar, nunca suscribirse ni entregar. Además, esta
 * separación es la que permite que publicar sea transaccional (outbox) mientras
 * que entregar es asíncrono.
 */
export interface EventPublisher {
  publish<TPayload>(
    event: EventDefinition<TPayload>,
    payload: TPayload,
    options?: PublishOptions,
  ): Promise<void>;
}

/**
 * Publicador transaccional: el evento se guarda en el outbox, no se entrega.
 * Si la transacción del caso de uso hace rollback, el evento desaparece con
 * ella. Si hace commit, el relay lo entregará tarde o temprano.
 */
export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly deps: { outbox: OutboxStore; clock: Clock; ids: IdGenerator }) {}

  async publish<TPayload>(
    event: EventDefinition<TPayload>,
    payload: TPayload,
    options: PublishOptions = {},
  ): Promise<void> {
    await this.deps.outbox.enqueue(createEnvelope(event, payload, options, this.deps));
  }
}

/** Publicador que recuerda lo publicado. Base de las aserciones en tests. */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: { type: string; payload: unknown }[] = [];

  publish<TPayload>(event: EventDefinition<TPayload>, payload: TPayload): Promise<void> {
    this.published.push({ type: event.type, payload });
    return Promise.resolve();
  }

  ofType<TPayload>(event: EventDefinition<TPayload>): TPayload[] {
    return this.published.filter((p) => p.type === event.type).map((p) => p.payload as TPayload);
  }
}
