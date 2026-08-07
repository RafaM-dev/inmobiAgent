import { NotFoundError, toAppError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import { assertSameTenant } from "../../../../platform/tenancy/tenant-context";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelDeliveryRepository } from "../../domain/repositories/channel-delivery.repository";
import { OutboundMessageDelivered, OutboundMessageFailed } from "../events/channels.events";
import { toAccountView } from "../mappers/channel-account.mapper";
import type { ChannelRegistry, DeliveryReceipt } from "../ports/chat-channel";
import type { DispatchReplyCommand, ReplyDispatcher } from "../ports/reply-dispatcher";
import { renderBlocks } from "../services/channel-renderer";

/**
 * Salida hacia el cliente (docs §7.3, paso 6).
 *
 * El orden importa: primero se degradan los bloques a lo que el canal soporta,
 * después se entrega. Quien compuso la respuesta nunca supo por dónde saldría.
 *
 * El fallo de entrega NO es una excepción: es un `Result` con su evento
 * `OutboundMessageFailed`. Que un proveedor esté caído es parte de la operación
 * normal de un producto conversacional, no un bug.
 */
export class DispatchReplyUseCase implements ReplyDispatcher {
  constructor(
    private readonly deps: {
      accounts: ChannelAccountRepository;
      channels: ChannelRegistry;
      deliveries: ChannelDeliveryRepository;
      events: EventPublisher;
      logger: Logger;
    },
  ) {}

  async dispatch(command: DispatchReplyCommand): Promise<Result<DeliveryReceipt, AppError>> {
    const account = await this.deps.accounts.findById(command.channelAccountId);
    if (!account) return err(new NotFoundError("Cuenta de canal", command.channelAccountId));
    assertSameTenant(account.tenantId, "cuenta de canal");

    const channel = this.deps.channels.get(account.channelType);
    if (!channel) return err(new NotFoundError("Canal", account.channelType));

    const view = toAccountView(account);
    const blocks = renderBlocks(command.blocks, channel.capabilities(view));

    if (blocks.length === 0) {
      return err(new NotFoundError("Respuesta vacía", command.messageId));
    }

    const sent = await channel
      .send({
        account: view,
        toExternalId: command.toExternalId,
        blocks,
        conversationId: command.conversationId,
        messageId: command.messageId,
      })
      .catch((error: unknown) => err(toAppError(error)));

    if (isErr(sent)) {
      await this.deps.events.publish(OutboundMessageFailed, {
        channelType: account.channelType,
        channelAccountId: account.id,
        conversationId: command.conversationId,
        messageId: command.messageId,
        errorCode: sent.error.code,
        reason: sent.error.message,
      });
      this.deps.logger.warn("Fallo al entregar la respuesta", {
        channelType: account.channelType,
        messageId: command.messageId,
        errorCode: sent.error.code,
      });
      return sent;
    }

    // Correlación con los ids del proveedor: sin esto, los acuses que lleguen
    // después no se pueden atribuir a ningún mensaje nuestro.
    const providerMessageIds =
      sent.value.providerMessageIds ??
      (sent.value.providerMessageId ? [sent.value.providerMessageId] : []);

    if (providerMessageIds.length > 0) {
      await this.deps.deliveries.recordSent({
        channelAccountId: account.id,
        conversationId: command.conversationId,
        messageId: command.messageId,
        providerMessageIds,
        sentAt: sent.value.deliveredAt,
      });
    }

    await this.deps.events.publish(OutboundMessageDelivered, {
      channelType: account.channelType,
      channelAccountId: account.id,
      conversationId: command.conversationId,
      messageId: command.messageId,
      ...(sent.value.providerMessageId
        ? { providerMessageId: sent.value.providerMessageId }
        : {}),
      deliveredAt: sent.value.deliveredAt.toISOString(),
    });

    return ok(sent.value);
  }
}
