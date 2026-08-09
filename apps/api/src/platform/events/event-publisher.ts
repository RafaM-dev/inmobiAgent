import type { Clock } from "../clock/clock";
import type { IdGenerator } from "../ids/id-generator";
import type { EventDefinition, EventSubscription, PublishOptions } from "./event";
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

/**
 * Publicador que además ENTREGA, en el momento y en el mismo hilo.
 *
 * Existe porque un doble que solo recuerda no puede probar nada de lo que
 * ocurre *por* un evento, y en este producto eso incluye una de sus promesas
 * centrales: que el CRM se llene solo cuando el catálogo muestra inmuebles, sin
 * que el modelo tenga que acordarse de registrar nada. Con un publicador que
 * solo apunta, esa cadena nunca se ejecuta y el test que la comprueba diría que
 * el CRM está vacío — que es exactamente lo que dijo la suite de evaluación
 * antes de existir esto.
 *
 * **Entrega sincrónica, a diferencia de producción**, donde el outbox y el
 * relay la hacen asíncrona y "al menos una vez". Es una simplificación
 * consciente y en la dirección segura: aquí se comprueba QUÉ pasa, no CUÁNDO.
 * Lo asíncrono —reserva, reintentos, dead-letter— tiene su propia suite contra
 * Postgres de verdad.
 */
export class DispatchingEventPublisher implements EventPublisher {
  readonly published: { type: string; payload: unknown }[] = [];
  private readonly subscriptions: EventSubscription[] = [];

  constructor(private readonly deps: { clock: Clock; ids: IdGenerator }) {}

  subscribe(...subscriptions: readonly EventSubscription[]): void {
    this.subscriptions.push(...subscriptions);
  }

  async publish<TPayload>(
    event: EventDefinition<TPayload>,
    payload: TPayload,
    options: PublishOptions = {},
  ): Promise<void> {
    this.published.push({ type: event.type, payload });

    const envelope = createEnvelope(event, payload, options, this.deps);
    for (const subscription of this.subscriptions) {
      if (subscription.event.type !== event.type) continue;
      /*
       * Un handler que falla no tumba a quien publicó: en producción tampoco lo
       * haría —son procesos distintos— y hacerlo aquí convertiría un fallo del
       * CRM en un turno del agente reventado, que es justo lo contrario de lo
       * que el diseño busca.
       */
      await subscription.handle(envelope);
    }
  }

  ofType<TPayload>(event: EventDefinition<TPayload>): TPayload[] {
    return this.published.filter((p) => p.type === event.type).map((p) => p.payload as TPayload);
  }
}
