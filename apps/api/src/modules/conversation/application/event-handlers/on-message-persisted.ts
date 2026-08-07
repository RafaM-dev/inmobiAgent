import { subscription, type EventSubscription } from "../../../../platform/events/event";
import { blocksToText } from "../../../channels";
import type { MessageRepository } from "../../domain/repositories/conversation.repositories";
import { MessagePersisted, type MessagePersistedPayload } from "../events/conversation.events";
import type { InboxStreamHub } from "../ports/inbox-stream";

/** Vista previa en la notificación. Lo justo para saber si hay que mirar. */
const PREVIEW_LENGTH = 120;

/**
 * Cada mensaje persistido empuja el inbox de los asesores conectados.
 *
 * Va por evento y no desde los casos de uso que escriben mensajes porque son
 * varios —el agente, el asesor, los recordatorios— y todos tendrían que
 * acordarse. El evento ya existía desde F1; aquí solo se le añade un
 * consumidor.
 *
 * El `tenantId` sale del sobre, que el bus restaura antes de invocar (D10): un
 * mensaje de una inmobiliaria no puede aparecer en la pantalla de otra.
 */
export const onMessagePersisted = (deps: {
  messages: MessageRepository;
  stream: InboxStreamHub;
}): EventSubscription =>
  subscription<MessagePersistedPayload>(
    "conversation.inbox-stream",
    MessagePersisted,
    async (envelope) => {
      // Si no hay nadie mirando, no se carga el mensaje: el inbox no puede
      // costarle una consulta por mensaje a un producto que nadie tiene abierto.
      if (deps.stream.connectionCount(envelope.tenantId) === 0) return;

      const message = await deps.messages.findById(envelope.payload.messageId);
      if (!message) return;

      const preview = blocksToText(message.blocks).replace(/\s+/g, " ").trim();

      deps.stream.publish(envelope.tenantId, {
        type: "message",
        payload: {
          conversationId: envelope.payload.conversationId,
          author: envelope.payload.authorType,
          preview:
            preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH)}…` : preview,
          sentAt: message.sentAt.toISOString(),
        },
      });
    },
  ) as EventSubscription;
