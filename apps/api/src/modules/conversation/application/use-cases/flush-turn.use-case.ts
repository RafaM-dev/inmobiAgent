import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import { ok, type Result } from "../../../../platform/result/result";
import type {
  ConversationLock,
  ConversationRepository,
  MessageRepository,
} from "../../domain/repositories/conversation.repositories";
import { TurnReady } from "../events/conversation.events";

export interface FlushTurnResult {
  readonly turnId: string | null;
  readonly messageCount: number;
  readonly skippedReason?: "locked" | "empty" | "bot_inactive" | "closed";
}

/**
 * Cierre del turno: convierte N mensajes sueltos en UN turno (docs §7.2).
 *
 * El candado por conversación es lo que impide que dos réplicas —o dos
 * temporizadores que se solapan— produzcan dos respuestas a la misma pregunta.
 * Que otro proceso tenga el candado no es un error: es "ya se está ocupando
 * alguien", y por eso se devuelve un resultado, no una excepción.
 *
 * Si un humano tomó la conversación, los mensajes quedan sin consumir a
 * propósito: el asesor los verá en el back-office y el bot no dirá nada.
 */
export class FlushTurnUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      messages: MessageRepository;
      lock: ConversationLock;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      ids: IdGenerator;
      logger: Logger;
    },
  ) {}

  async execute(conversationId: string): Promise<Result<FlushTurnResult, AppError>> {
    const result = await this.deps.lock.withLock(conversationId, async () =>
      this.deps.unitOfWork.run(async (): Promise<FlushTurnResult> => {
        const conversation = await this.deps.conversations.findById(conversationId);
        if (!conversation || conversation.isClosed) {
          return { turnId: null, messageCount: 0, skippedReason: "closed" };
        }
        if (!conversation.isBotActive) {
          return { turnId: null, messageCount: 0, skippedReason: "bot_inactive" };
        }

        const pending = await this.deps.messages.listPendingTurnMessages(conversationId);
        if (pending.length === 0) {
          return { turnId: null, messageCount: 0, skippedReason: "empty" };
        }

        const turnId = this.deps.ids.generate();
        const ids = pending.map((m) => m.id);
        await this.deps.messages.assignTurn(ids, turnId);

        await this.deps.events.publish(TurnReady, {
          conversationId,
          turnId,
          contactId: conversation.contactId,
          channelType: conversation.channelType,
          channelAccountId: conversation.channelAccountId,
          externalContactId: conversation.externalContactId,
          messageIds: ids,
          text: pending
            .map((m) => m.text)
            .filter((t) => t.length > 0)
            .join("\n"),
        });

        this.deps.logger.debug("Turno listo", { conversationId, turnId, messages: ids.length });
        return { turnId, messageCount: ids.length };
      }),
    );

    // `null` = el candado estaba tomado por otro proceso.
    return ok(result ?? { turnId: null, messageCount: 0, skippedReason: "locked" });
  }
}
