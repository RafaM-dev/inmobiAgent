import type { Logger } from "../../../../platform/logging/logger";
import { subscription, type EventSubscription } from "../../../../platform/events/event";
import { isErr } from "../../../../platform/result/result";
import { PropertyShown, type PropertyShownPayload } from "../../../catalog";
import type { RegisterLeadInterestUseCase } from "../use-cases/register-lead-interest.use-case";

/**
 * `catalog.property_shown` → interés registrado en el CRM.
 *
 * El nombre de la suscripción es la clave de idempotencia en `inbox_events`: el
 * bus puede entregar el mismo evento dos veces y el interés se anota una.
 *
 * El `tenantId` no viaja por parámetro: el bus restaura el `TenantContext` del
 * sobre antes de invocar al handler (decisión D10), así que el repositorio lo
 * encuentra donde siempre.
 */
export const onPropertyShown = (deps: {
  registerInterest: RegisterLeadInterestUseCase;
  logger: Logger;
}): EventSubscription =>
  subscription<PropertyShownPayload>("leads.on-property-shown", PropertyShown, async (envelope) => {
    const result = await deps.registerInterest.execute({
      conversationId: envelope.payload.conversationId,
      contactId: envelope.payload.contactId,
      propertyRefs: envelope.payload.refs,
      shownAt: envelope.occurredAt,
    });

    if (isErr(result)) {
      // No se relanza: que el CRM no pueda anotar un interés no debe romper la
      // conversación que el cliente está teniendo ahora mismo.
      deps.logger.warn("No se pudo registrar el interés del lead", {
        conversationId: envelope.payload.conversationId,
        errorCode: result.error.code,
      });
      return;
    }

    deps.logger.debug("Interés registrado", {
      leadId: result.value.id,
      score: result.value.score,
      band: result.value.band,
      properties: envelope.payload.refs.length,
    });
  }) as EventSubscription;
