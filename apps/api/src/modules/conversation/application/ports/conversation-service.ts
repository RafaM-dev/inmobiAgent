import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { ProfileChange } from "../../domain/entities/contact-profile";
import type {
  AppendOutboundMessageCommand,
  AppendOutboundMessageResult,
} from "../use-cases/append-outbound-message.use-case";
import type { ConversationContext } from "../use-cases/get-conversation-context.use-case";
import type { UpdateContactProfileCommand } from "../use-cases/update-contact-profile.use-case";

/**
 * Puerto público de `conversation`.
 *
 * Es lo que usará el agente en F2 y el back-office en F7. Tres operaciones:
 * leer el contexto, responder y recordar. Nada de repositorios, nada de
 * entidades: quien consuma este puerto no puede corromper el estado de una
 * conversación aunque quiera.
 */
export interface ConversationService {
  getContext(conversationId: string): Promise<Result<ConversationContext, AppError>>;

  reply(
    command: AppendOutboundMessageCommand,
  ): Promise<Result<AppendOutboundMessageResult, AppError>>;

  remember(
    command: UpdateContactProfileCommand,
  ): Promise<Result<readonly ProfileChange[], AppError>>;

  /**
   * Silencia al bot en esta conversación. Lo usa el agente al escalar y lo
   * usará el back-office cuando un asesor tome el control (F7).
   */
  pauseBot(conversationId: string, reason: string): Promise<Result<void, AppError>>;
}
