import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { ReplyBlock } from "../../domain/value-objects/reply-block";
import type { DeliveryReceipt } from "./chat-channel";

export interface DispatchReplyCommand {
  readonly channelAccountId: string;
  readonly toExternalId: string;
  readonly conversationId: string;
  /** Id del mensaje saliente ya persistido por `conversation`. */
  readonly messageId: string;
  /** Bloques SIN degradar: el despachador aplica las capacidades del canal. */
  readonly blocks: readonly ReplyBlock[];
}

/**
 * Puerto público de salida de `channels`.
 *
 * Quien compone una respuesta (hoy el eco de desarrollo, en F2 el agente) la
 * entrega aquí y se olvida. No sabe por qué canal saldrá, ni si habrá que
 * convertir botones en una lista numerada, ni cuántos mensajes hará falta.
 */
export interface ReplyDispatcher {
  dispatch(command: DispatchReplyCommand): Promise<Result<DeliveryReceipt, AppError>>;
}
