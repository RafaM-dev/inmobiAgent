import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ChannelDeliveryRepository } from "../../domain/repositories/channel-delivery.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import { DeliveryStatus, type DeliveryStatusUpdate } from "../ports/chat-channel";
import { OutboundMessageFailed } from "../events/channels.events";

export interface ApplyDeliveryStatusCommand {
  readonly channelType: ChannelType;
  readonly tenantId: string;
  readonly updates: readonly DeliveryStatusUpdate[];
}

/**
 * Acuses de entrega del proveedor → estado de nuestros mensajes.
 *
 * Un acuse que no corresponde a ningún mensaje nuestro se ignora sin ruido: es
 * lo normal si la inmobiliaria usa además la app de WhatsApp Business sobre el
 * mismo número, o si el mensaje se envió antes de este despliegue.
 *
 * Solo el fallo genera evento. "Entregado" y "leído" son ruido para el resto
 * del sistema —los verá el back-office consultando la tabla—, pero un fallo sí
 * necesita que alguien reaccione: es un cliente que no recibió la respuesta.
 */
export class ApplyDeliveryStatusUseCase {
  constructor(
    private readonly deps: {
      deliveries: ChannelDeliveryRepository;
      events: EventPublisher;
      logger: Logger;
    },
  ) {}

  async execute(command: ApplyDeliveryStatusCommand): Promise<Result<number, AppError>> {
    let applied = 0;

    for (const update of command.updates) {
      const record = await this.deps.deliveries.applyStatus({
        providerMessageId: update.providerMessageId,
        status: update.status,
        occurredAt: update.occurredAt,
        ...(update.reason !== undefined ? { reason: update.reason } : {}),
      });

      if (!record) continue;
      applied += 1;

      if (update.status !== DeliveryStatus.FAILED) continue;

      // El evento se publica dentro del contexto del tenant dueño del mensaje,
      // que sale de la fila y no del payload del proveedor.
      await TenantContext.run(
        {
          tenantId: command.tenantId,
          correlationId: `delivery-${update.providerMessageId}`,
          source: "webhook",
        },
        async () => {
          await this.deps.events.publish(OutboundMessageFailed, {
            channelType: command.channelType,
            channelAccountId: record.channelAccountId,
            conversationId: record.conversationId,
            messageId: record.messageId,
            errorCode: "PROVIDER_DELIVERY_FAILED",
            reason: update.reason ?? "El proveedor no pudo entregar el mensaje",
          });
        },
      );

      this.deps.logger.warn("El proveedor no entregó un mensaje", {
        channelType: command.channelType,
        messageId: record.messageId,
        reason: update.reason,
      });
    }

    return ok(applied);
  }
}
