import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import { subscription, type EventSubscription } from "../../../../platform/events/event";
import { InboundMessageReceived } from "../../../channels";
import type { IngestInboundMessageUseCase } from "../use-cases/ingest-inbound-message.use-case";

/**
 * Única costura entre `channels` y `conversation`.
 *
 * Es asíncrona a propósito: el webhook del proveedor ya recibió su 200 y se
 * fue. Si aquí falla algo, el outbox reintenta con backoff sin que el
 * proveedor reenvíe nada ni el cliente note un timeout.
 *
 * El nombre del handler es la clave de idempotencia en `inbox_events`: cambiarlo
 * haría que se reprocesaran eventos ya procesados. No se renombra a la ligera.
 */
export const onInboundMessageReceived = (deps: {
  ingest: IngestInboundMessageUseCase;
  logger: Logger;
}): EventSubscription =>
  subscription("conversation.ingest-inbound-message", InboundMessageReceived, async (envelope) => {
    const payload = envelope.payload;

    const result = await deps.ingest.execute({
      channelType: payload.channelType,
      channelAccountId: payload.channelAccountId,
      externalMessageId: payload.externalMessageId,
      externalContactId: payload.externalContactId,
      contactDisplayName: payload.contactDisplayName,
      content: payload.content,
      receivedAt: new Date(payload.receivedAt),
    });

    // Se relanza para que el bus libere el claim y el outbox reintente.
    if (isErr(result)) {
      deps.logger.warn("No se pudo ingerir el mensaje entrante", {
        externalMessageId: payload.externalMessageId,
        errorCode: result.error.code,
      });
      throw result.error;
    }
  }) as EventSubscription;
