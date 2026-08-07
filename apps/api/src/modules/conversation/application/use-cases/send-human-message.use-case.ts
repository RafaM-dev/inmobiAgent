import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import { assertSameTenant } from "../../../../platform/tenancy/tenant-context";
import { textBlock } from "../../../channels";
import { MessageAuthorType } from "../../domain/entities/message";
import type { ConversationRepository } from "../../domain/repositories/conversation.repositories";
import type { AppendOutboundMessageUseCase } from "./append-outbound-message.use-case";
import type { SetConversationControlUseCase } from "./set-conversation-control.use-case";

export interface SendHumanMessageCommand {
  readonly conversationId: string;
  readonly userId: string;
  readonly text: string;
}

/**
 * Un asesor escribe al cliente desde el back-office.
 *
 * **Escribir es tomar la conversación.** Si el bot seguía al mando, se le
 * silencia antes de enviar: dos voces contestando al mismo cliente es la peor
 * experiencia posible, y esperar a que el asesor se acuerde de pulsar "tomar
 * control" garantiza que algún día no lo haga.
 *
 * El mensaje sale con autoría `HUMAN`, no `AGENT`. Esa distinción viaja hasta
 * el historial y hasta la traza: importa saber quién dijo qué cuando alguien
 * revise una conversación dentro de tres meses.
 */
export class SendHumanMessageUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      appendOutbound: AppendOutboundMessageUseCase;
      setControl: SetConversationControlUseCase;
      logger: Logger;
    },
  ) {}

  async execute(command: SendHumanMessageCommand): Promise<Result<{ messageId: string }, AppError>> {
    const conversation = await this.deps.conversations.findById(command.conversationId);
    if (!conversation) return err(new NotFoundError("Conversación", command.conversationId));
    assertSameTenant(conversation.tenantId, "conversación");

    if (conversation.status !== "HUMAN") {
      const taken = await this.deps.setControl.execute(command.conversationId, {
        action: "assign_human",
        userId: command.userId,
      });
      if (isErr(taken)) return taken;
    }

    const sent = await this.deps.appendOutbound.execute({
      conversationId: command.conversationId,
      blocks: [textBlock(command.text.trim())],
      authorType: MessageAuthorType.HUMAN,
      authorId: command.userId,
    });

    if (isErr(sent)) return sent;

    this.deps.logger.info("Mensaje enviado por un asesor", {
      conversationId: command.conversationId,
      userId: command.userId,
    });

    return ok({ messageId: sent.value.messageId });
  }
}
