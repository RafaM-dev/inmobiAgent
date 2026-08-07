import type { Clock } from "../../../../platform/clock/clock";
import { ConflictError, type AppError } from "../../../../platform/errors/app-error";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { err, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { ChannelAccount } from "../../domain/entities/channel-account";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import { toAccountView } from "../mappers/channel-account.mapper";
import type { ChannelAccountView } from "../ports/chat-channel";

export interface RegisterChannelAccountCommand {
  readonly channelType: ChannelType;
  readonly externalId: string;
  readonly displayName: string;
  readonly config?: Record<string, unknown>;
}

/**
 * Da de alta la cuenta de canal de una inmobiliaria.
 *
 * Idempotente por diseño: si la cuenta ya existe para este tenant, se devuelve
 * tal cual en vez de fallar. Así el seed, un despliegue repetido o un doble
 * clic en el back-office no rompen nada. Si existe pero es de OTRO tenant, es
 * un conflicto real: `(canal, id externo)` es único en toda la plataforma
 * porque es lo que resuelve el tenant de cada mensaje entrante.
 */
export class RegisterChannelAccountUseCase {
  constructor(
    private readonly deps: {
      accounts: ChannelAccountRepository;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(
    command: RegisterChannelAccountCommand,
  ): Promise<Result<ChannelAccountView, AppError>> {
    const tenantId = TenantContext.requireTenantId();

    const existing = await this.deps.accounts.findByExternalId(
      command.channelType,
      command.externalId,
    );

    if (existing) {
      if (existing.tenantId !== tenantId) {
        return err(
          new ConflictError(
            `La cuenta ${command.channelType}/${command.externalId} ya está en uso por otra inmobiliaria`,
          ),
        );
      }
      return ok(toAccountView(existing));
    }

    const account = ChannelAccount.create({
      id: this.deps.ids.generate(),
      tenantId,
      channelType: command.channelType,
      externalId: command.externalId,
      displayName: command.displayName,
      ...(command.config ? { config: command.config } : {}),
      now: this.deps.clock.now(),
    });

    await this.deps.accounts.save(account);
    return ok(toAccountView(account));
  }
}
