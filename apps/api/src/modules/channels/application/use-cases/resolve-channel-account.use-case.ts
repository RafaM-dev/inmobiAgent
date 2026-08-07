import { ForbiddenError, NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import { toAccountView } from "../mappers/channel-account.mapper";
import type { ChannelAccountView } from "../ports/chat-channel";

/**
 * Resuelve una cuenta de canal activa a partir de su identificador público.
 *
 * Existe para que la capa `interface` nunca toque un repositorio: las rutas
 * piden casos de uso, y así el día que esto consulte una caché o un servicio
 * remoto, no hay que tocar ni una ruta.
 */
export class ResolveChannelAccountUseCase {
  constructor(private readonly deps: { accounts: ChannelAccountRepository }) {}

  async execute(
    channelType: ChannelType,
    externalId: string,
  ): Promise<Result<ChannelAccountView, AppError>> {
    const account = await this.deps.accounts.findByExternalId(channelType, externalId);
    if (!account) return err(new NotFoundError("Cuenta de canal", externalId));
    if (!account.isActive) return err(new ForbiddenError("La cuenta de canal está desactivada"));
    return ok(toAccountView(account));
  }
}
