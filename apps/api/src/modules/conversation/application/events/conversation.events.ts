import { defineEvent } from "../../../../platform/events/event";
import type { ChannelType } from "../../../channels";

/**
 * Eventos de integración de `conversation`.
 *
 * `TurnReady` es la costura sobre la que se enchufa el agente en F2: hoy lo
 * consume un eco de desarrollo y mañana el orquestador de IA. Ninguno de los
 * dos obliga a cambiar este módulo, que es exactamente el objetivo.
 */

export interface ConversationStartedPayload {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
}

export const ConversationStarted = defineEvent<ConversationStartedPayload>("conversation.started");

export interface MessagePersistedPayload {
  readonly conversationId: string;
  readonly messageId: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly authorType: string;
}

export const MessagePersisted = defineEvent<MessagePersistedPayload>(
  "conversation.message_persisted",
);

export interface TurnReadyPayload {
  readonly conversationId: string;
  readonly turnId: string;
  readonly contactId: string;
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  /** A dónde se responde en el proveedor. */
  readonly externalContactId: string;
  /** Mensajes agrupados en este turno, en orden de llegada. */
  readonly messageIds: readonly string[];
  /** Texto ya unificado de esos mensajes: es lo que "dijo" el cliente. */
  readonly text: string;
}

export const TurnReady = defineEvent<TurnReadyPayload>("conversation.turn_ready");

export interface ConversationIdlePayload {
  readonly conversationId: string;
  readonly contactId: string;
  readonly lastActivityAt: string;
}

export const ConversationIdle = defineEvent<ConversationIdlePayload>("conversation.idle");

export interface ConversationClosedPayload {
  readonly conversationId: string;
  readonly contactId: string;
  readonly reason: string;
}

export const ConversationClosed = defineEvent<ConversationClosedPayload>("conversation.closed");
