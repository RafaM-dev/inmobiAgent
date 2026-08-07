import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { ConflictError, NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import { assertSameTenant, TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ReplyBlock, ReplyDispatcher } from "../../../channels";
import { MessageAuthorType, Message } from "../../domain/entities/message";
import type {
  ConversationRepository,
  MessageRepository,
} from "../../domain/repositories/conversation.repositories";
import { MessagePersisted } from "../events/conversation.events";

export interface AppendOutboundMessageCommand {
  readonly conversationId: string;
  readonly blocks: readonly ReplyBlock[];
  readonly authorType?: MessageAuthorType;
  readonly authorId?: string | undefined;
}

export interface AppendOutboundMessageResult {
  readonly messageId: string;
  readonly delivered: boolean;
}

/**
 * Respuesta hacia el cliente: se guarda y se entrega, en ese orden.
 *
 * El orden no es un detalle. Persistir ANTES de enviar significa que, si el
 * proveedor falla, queda registro de lo que se intentó decir y el asesor puede
 * reenviarlo. Al revés, un fallo de red borraría de la historia una respuesta
 * que quizá el cliente sí llegó a ver.
 *
 * La regla "si un humano tomó la conversación, el bot calla" se comprueba aquí
 * y no en el agente: así vale para cualquier autor automático, presente o futuro.
 */
export class AppendOutboundMessageUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      messages: MessageRepository;
      dispatcher: ReplyDispatcher;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(
    command: AppendOutboundMessageCommand,
  ): Promise<Result<AppendOutboundMessageResult, AppError>> {
    const tenantId = TenantContext.requireTenantId();
    const authorType = command.authorType ?? MessageAuthorType.AGENT;

    const conversation = await this.deps.conversations.findById(command.conversationId);
    if (!conversation) return err(new NotFoundError("Conversación", command.conversationId));
    assertSameTenant(conversation.tenantId, "conversación");

    if (conversation.isClosed) {
      return err(new ConflictError("La conversación está cerrada"));
    }
    if (authorType === MessageAuthorType.AGENT && !conversation.isBotActive) {
      return err(
        new ConflictError("La conversación la atiende un humano; el bot no responde", {
          conversationId: conversation.id,
          status: conversation.status,
        }),
      );
    }

    const now = this.deps.clock.now();
    const message = Message.outbound({
      id: this.deps.ids.generate(),
      tenantId,
      conversationId: conversation.id,
      authorType,
      authorId: command.authorId,
      blocks: command.blocks,
      now,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.messages.save(message);
      conversation.registerOutbound(now);
      await this.deps.conversations.save(conversation);
      await this.deps.events.publish(MessagePersisted, {
        conversationId: conversation.id,
        messageId: message.id,
        direction: "OUTBOUND",
        authorType,
      });
    });

    // La entrega va fuera de la transacción: una llamada de red no puede
    // mantener abierta una transacción de base de datos.
    const delivery = await this.deps.dispatcher.dispatch({
      channelAccountId: conversation.channelAccountId,
      toExternalId: conversation.externalContactId,
      conversationId: conversation.id,
      messageId: message.id,
      blocks: command.blocks,
    });

    if (isErr(delivery)) {
      message.markFailed(delivery.error.message);
      await this.deps.messages.save(message);
      return ok({ messageId: message.id, delivered: false });
    }

    message.markSent(delivery.value.providerMessageId);
    await this.deps.messages.save(message);

    return ok({ messageId: message.id, delivered: true });
  }
}
