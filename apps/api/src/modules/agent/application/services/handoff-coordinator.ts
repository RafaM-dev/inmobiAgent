import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import type { ConversationService } from "../../../conversation";
import { handoffMessage, type HandoffReason } from "../../domain/policies/escalation.policy";
import { HandoffRequested } from "../events/agent.events";

export interface HandoffOutcome {
  readonly reason: HandoffReason;
  /** Mensaje que se le envía al cliente. */
  readonly message: string;
}

/**
 * Escalamiento a una persona.
 *
 * Existe como servicio propio porque hay DOS caminos hasta aquí y ambos deben
 * hacer exactamente lo mismo:
 *
 *  · la política determinista, que detecta "quiero hablar con alguien" sin
 *    gastar un token ni un milisegundo de latencia;
 *  · la herramienta `request_human_agent`, para lo que el modelo capte y las
 *    reglas no.
 *
 * Duplicar esta lógica en los dos sitios sería la forma más rápida de que un
 * día el bot siga respondiendo después de haber dicho "te paso con un asesor".
 *
 * El orden importa: primero se silencia al bot, después se avisa. Al revés,
 * una notificación lenta dejaría una ventana en la que el bot sigue hablando.
 */
export class HandoffCoordinator {
  constructor(
    private readonly deps: {
      conversations: ConversationService;
      events: EventPublisher;
      logger: Logger;
    },
  ) {}

  async request(input: {
    conversationId: string;
    contactId: string;
    reason: HandoffReason;
    advisorName?: string;
    note?: string;
  }): Promise<HandoffOutcome> {
    const paused = await this.deps.conversations.pauseBot(input.conversationId, input.reason);
    if (isErr(paused)) {
      // No se puede silenciar al bot: se registra y se sigue, porque el cliente
      // debe recibir igualmente el aviso de que va a atenderle una persona.
      this.deps.logger.error("No se pudo pausar el bot al escalar", {
        conversationId: input.conversationId,
        errorCode: paused.error.code,
      });
    }

    await this.deps.events.publish(HandoffRequested, {
      conversationId: input.conversationId,
      contactId: input.contactId,
      reason: input.reason,
      ...(input.note ? { note: input.note } : {}),
    });

    this.deps.logger.info("Conversación escalada a un humano", {
      conversationId: input.conversationId,
      reason: input.reason,
    });

    return {
      reason: input.reason,
      message: handoffMessage(input.reason, input.advisorName),
    };
  }
}
