import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";

/**
 * Proyección para el back-office.
 *
 * NO se reutiliza `ChannelAccountView` a propósito: esa vista incluye `config`,
 * donde viven las credenciales cifradas del proveedor. Es la vista que reciben
 * los adaptadores, que sí las necesitan; devolverla al navegador sacaría
 * secretos del servidor por reutilizar un tipo. Un tipo distinto por cada
 * frontera es más código y muchísimo menos peligroso.
 */
export interface ChannelAccountSummary {
  readonly id: string;
  readonly channelType: ChannelType;
  readonly externalId: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

/**
 * Canales conectados de la inmobiliaria.
 *
 * A diferencia de `ResolveChannelAccount` —que descubre el tenant a partir de
 * la cuenta por la que entró un mensaje— aquí el tenant ya se conoce: sale de
 * la sesión del asesor. Por eso esta consulta sí va acotada, y por eso no
 * recibe ningún identificador: no hay forma de pedir los canales de otra
 * inmobiliaria.
 */
export class ListChannelAccountsUseCase {
  constructor(private readonly deps: { accounts: ChannelAccountRepository }) {}

  async execute(): Promise<Result<readonly ChannelAccountSummary[], AppError>> {
    const accounts = await this.deps.accounts.listByTenant(TenantContext.requireTenantId());

    return ok(
      accounts.map((account) => ({
        id: account.id,
        channelType: account.channelType,
        externalId: account.externalId,
        displayName: account.displayName,
        isActive: account.isActive,
      })),
    );
  }
}
