import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { ProfileChange } from "../../domain/entities/contact-profile";
import type { ConversationService } from "../ports/conversation-service";
import type {
  AppendOutboundMessageCommand,
  AppendOutboundMessageResult,
  AppendOutboundMessageUseCase,
} from "../use-cases/append-outbound-message.use-case";
import type {
  ConversationContext,
  GetConversationContextUseCase,
} from "../use-cases/get-conversation-context.use-case";
import type { SetConversationControlUseCase } from "../use-cases/set-conversation-control.use-case";
import type {
  UpdateContactProfileCommand,
  UpdateContactProfileUseCase,
} from "../use-cases/update-contact-profile.use-case";

/**
 * Fachada del módulo: traduce el puerto público a casos de uso concretos.
 *
 * Existe para que el contrato que ven los demás módulos sea una interfaz
 * estable y no un puñado de clases. Reorganizar los casos de uso por dentro no
 * rompe a nadie mientras esta fachada siga cumpliendo lo prometido.
 */
export class ConversationServiceFacade implements ConversationService {
  constructor(
    private readonly deps: {
      getContext: GetConversationContextUseCase;
      appendOutbound: AppendOutboundMessageUseCase;
      updateProfile: UpdateContactProfileUseCase;
      setControl: SetConversationControlUseCase;
    },
  ) {}

  getContext(conversationId: string): Promise<Result<ConversationContext, AppError>> {
    return this.deps.getContext.execute(conversationId);
  }

  reply(
    command: AppendOutboundMessageCommand,
  ): Promise<Result<AppendOutboundMessageResult, AppError>> {
    return this.deps.appendOutbound.execute(command);
  }

  remember(
    command: UpdateContactProfileCommand,
  ): Promise<Result<readonly ProfileChange[], AppError>> {
    return this.deps.updateProfile.execute(command);
  }

  pauseBot(conversationId: string, reason: string): Promise<Result<void, AppError>> {
    return this.deps.setControl.execute(conversationId, { action: "pause_bot", reason });
  }
}
