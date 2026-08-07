import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import { err, okVoid, type Result } from "../../../../platform/result/result";
import { assertSameTenant } from "../../../../platform/tenancy/tenant-context";
import type { ConversationRepository } from "../../domain/repositories/conversation.repositories";
import type { TurnScheduler } from "../ports/turn-scheduler";
import { ConversationClosed } from "../events/conversation.events";

export type ConversationControl =
  /** El bot deja de responder, a la espera de que alguien la tome. */
  | { readonly action: "pause_bot"; readonly reason: string }
  /** Un asesor toma el control. */
  | { readonly action: "assign_human"; readonly userId: string }
  /** Vuelve al bot. */
  | { readonly action: "return_to_bot" }
  | { readonly action: "close"; readonly reason: string };

/**
 * Cambia quién manda en una conversación.
 *
 * Está en un solo caso de uso porque todas estas transiciones comparten un
 * efecto que es fácil olvidar por separado: **cancelar el turno pendiente**. Si
 * un asesor toma la conversación y queda un temporizador en marcha, el bot
 * responde encima del humano — el peor fallo posible de este producto.
 */
export class SetConversationControlUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      turnScheduler: TurnScheduler;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
    },
  ) {}

  async execute(
    conversationId: string,
    control: ConversationControl,
  ): Promise<Result<void, AppError>> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!conversation) return err(new NotFoundError("Conversación", conversationId));
    assertSameTenant(conversation.tenantId, "conversación");

    const now = this.deps.clock.now();

    await this.deps.unitOfWork.run(async () => {
      switch (control.action) {
        case "pause_bot":
          conversation.pauseBot(now);
          break;
        case "assign_human":
          conversation.assignToHuman(control.userId, now);
          break;
        case "return_to_bot":
          conversation.returnToBot(now);
          break;
        case "close":
          conversation.close(now);
          await this.deps.events.publish(ConversationClosed, {
            conversationId,
            contactId: conversation.contactId,
            reason: control.reason,
          });
          break;
      }
      await this.deps.conversations.save(conversation);
    });

    // Fuera de la transacción: es un efecto en memoria, no persistente.
    if (control.action !== "return_to_bot") {
      this.deps.turnScheduler.cancel(conversationId);
    }

    return okVoid();
  }
}
