import { defineEvent } from "../../../../platform/events/event";
import type { InboundContent } from "../../domain/value-objects/inbound-message";
import type { ChannelType } from "../../domain/value-objects/channel-type";

/**
 * Eventos de integración de `channels`.
 *
 * `InboundMessageReceived` es la frontera del sistema: a partir de aquí nadie
 * vuelve a hablar de proveedores. `conversation` lo consume y persiste; el
 * agente ni se entera de por dónde entró el mensaje.
 */

export interface InboundMessageReceivedPayload {
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly externalMessageId: string;
  readonly externalContactId: string;
  readonly contactDisplayName?: string;
  readonly content: readonly InboundContent[];
  /** ISO-8601: el sobre viaja como JSON, las fechas no sobreviven como Date. */
  readonly receivedAt: string;
}

export const InboundMessageReceived = defineEvent<InboundMessageReceivedPayload>(
  "channels.inbound_message_received",
);

export interface OutboundMessageDeliveredPayload {
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly providerMessageId?: string;
  readonly deliveredAt: string;
}

export const OutboundMessageDelivered = defineEvent<OutboundMessageDeliveredPayload>(
  "channels.outbound_message_delivered",
);

export interface OutboundMessageFailedPayload {
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly errorCode: string;
  readonly reason: string;
}

export const OutboundMessageFailed = defineEvent<OutboundMessageFailedPayload>(
  "channels.outbound_message_failed",
);
