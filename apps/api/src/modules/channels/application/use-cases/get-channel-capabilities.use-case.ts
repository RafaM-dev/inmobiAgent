import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelCapabilities } from "../../domain/value-objects/channel-capabilities";
import { toAccountView } from "../mappers/channel-account.mapper";
import type { ChannelRegistry } from "../ports/chat-channel";

/**
 * Qué sabe hacer el canal de una conversación concreta.
 *
 * Lo consulta el agente antes de componer una respuesta. Es lo que le permite
 * ofrecer botones donde los hay y texto donde no, sin que exista en ninguna
 * parte un `if (canal === "whatsapp")`.
 */
export class GetChannelCapabilitiesUseCase {
  constructor(
    private readonly deps: {
      accounts: ChannelAccountRepository;
      channels: ChannelRegistry;
    },
  ) {}

  async execute(channelAccountId: string): Promise<Result<ChannelCapabilities, AppError>> {
    const account = await this.deps.accounts.findById(channelAccountId);
    if (!account) return err(new NotFoundError("Cuenta de canal", channelAccountId));

    const channel = this.deps.channels.get(account.channelType);
    if (!channel) return err(new NotFoundError("Canal", account.channelType));

    return ok(channel.capabilities(toAccountView(account)));
  }
}
