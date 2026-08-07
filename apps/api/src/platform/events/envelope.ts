import type { Clock } from "../clock/clock";
import type { IdGenerator } from "../ids/id-generator";
import { TenantContext } from "../tenancy/tenant-context";
import type { EventDefinition, EventEnvelope, PublishOptions } from "./event";

/**
 * Construcción del sobre de un evento.
 *
 * Vive aparte del bus y del publicador para que ambos puedan usarla sin crear
 * una dependencia circular entre ellos (regla `no-circular` de arquitectura).
 *
 * El `tenantId` y el `correlationId` se toman del ExecutionContext activo: el
 * emisor no tiene que acordarse de propagar la traza.
 */
export const createEnvelope = <TPayload>(
  event: EventDefinition<TPayload>,
  payload: TPayload,
  options: PublishOptions,
  deps: { clock: Clock; ids: IdGenerator },
): EventEnvelope<TPayload> => {
  const ctx = TenantContext.peek();
  return {
    eventId: deps.ids.generate(),
    type: event.type,
    version: event.version,
    tenantId: options.tenantId ?? ctx?.tenantId ?? "system",
    occurredAt: options.occurredAt ?? deps.clock.now(),
    correlationId: options.correlationId ?? ctx?.correlationId ?? deps.ids.generate(),
    ...(options.causationId ? { causationId: options.causationId } : {}),
    payload,
  };
};
