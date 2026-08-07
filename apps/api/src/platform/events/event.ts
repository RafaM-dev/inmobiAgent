/**
 * Contrato de eventos.
 *
 * Un evento es un hecho consumado, inmutable, nombrado en pasado
 * (`lead.captured`, no `capture_lead`). Es la única forma de comunicación
 * asíncrona entre módulos y el mecanismo que permitirá extraer un módulo a
 * microservicio sin reescribir a quien lo consume.
 */

/**
 * Definición tipada de un evento. La publica el módulo dueño en su `index.ts`;
 * los consumidores la importan para suscribirse con seguridad de tipos.
 *
 * `version` permite evolucionar el payload: se publica `v2` en paralelo y los
 * consumidores migran a su ritmo.
 */
export interface EventDefinition<TPayload> {
  readonly type: string;
  readonly version: number;
  /** Marcador de tipo. No existe en runtime. */
  readonly __payload?: TPayload;
}

export const defineEvent = <TPayload>(type: string, version = 1): EventDefinition<TPayload> => ({
  type,
  version,
});

/** Sobre de transporte común a todos los eventos. */
export interface EventEnvelope<TPayload = unknown> {
  readonly eventId: string;
  readonly type: string;
  readonly version: number;
  readonly tenantId: string;
  readonly occurredAt: Date;
  /** Une toda la cadena de un turno: webhook → job → agente → canal. */
  readonly correlationId: string;
  /** Id del evento o comando que causó este. Permite reconstruir el árbol. */
  readonly causationId?: string;
  readonly payload: TPayload;
}

export interface PublishOptions {
  /** Sobrescribe el tenant del contexto (jobs de sistema, migraciones). */
  tenantId?: string;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
}

export type EventHandler<TPayload> = (envelope: EventEnvelope<TPayload>) => Promise<void> | void;

/**
 * Un consumidor registrado. El `name` es obligatorio porque es la clave de
 * idempotencia en la tabla `inbox_events`: un evento se procesa una sola vez
 * por cada handler, aunque el bus lo entregue dos veces.
 */
export interface EventSubscription<TPayload = unknown> {
  readonly name: string;
  readonly event: EventDefinition<TPayload>;
  readonly handle: EventHandler<TPayload>;
}

export const subscription = <TPayload>(
  name: string,
  event: EventDefinition<TPayload>,
  handle: EventHandler<TPayload>,
): EventSubscription<TPayload> => ({ name, event, handle });
