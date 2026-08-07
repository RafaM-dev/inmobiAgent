import { subscription, type EventSubscription } from "../../../../platform/events/event";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import { TurnReady } from "../../../conversation";
import type { RunAgentTurnUseCase } from "../use-cases/run-agent-turn.use-case";

/**
 * La costura entre `conversation` y `agent`.
 *
 * Es exactamente la misma a la que estaba enganchado el eco de desarrollo en
 * F1. Cambiar quién responde ha sido cambiar el suscriptor de este evento: ni
 * el canal ni el módulo de conversaciones se han enterado, que era justo lo que
 * queríamos demostrar antes de escribir una línea de IA.
 *
 * El nombre del handler es la clave de idempotencia en `inbox_events`: un turno
 * no se ejecuta dos veces aunque el outbox reintente la entrega.
 */
export const onTurnReady = (deps: {
  runTurn: RunAgentTurnUseCase;
  logger: Logger;
}): EventSubscription =>
  subscription("agent.run-turn", TurnReady, async (envelope) => {
    const payload = envelope.payload;

    const result = await deps.runTurn.execute({
      conversationId: payload.conversationId,
      turnId: payload.turnId,
      contactId: payload.contactId,
      text: payload.text,
      correlationId: envelope.correlationId,
    });

    if (isErr(result)) {
      deps.logger.warn("El turno del agente no pudo completarse", {
        conversationId: payload.conversationId,
        turnId: payload.turnId,
        errorCode: result.error.code,
      });
      // Se relanza para que el outbox reintente con backoff.
      throw result.error;
    }
  }) as EventSubscription;
