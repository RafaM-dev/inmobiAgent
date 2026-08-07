import type { ChannelAccount } from "../entities/channel-account";
import type { ChannelType } from "../value-objects/channel-type";

/**
 * Puerto de persistencia de cuentas de canal.
 *
 * `findByExternalId` no lleva ámbito de tenant a propósito: es la consulta que
 * *descubre* el tenant a partir de la cuenta por la que entró el mensaje, y se
 * ejecuta antes de que exista contexto alguno.
 */
export interface ChannelAccountRepository {
  findById(id: string): Promise<ChannelAccount | null>;
  findByExternalId(channelType: ChannelType, externalId: string): Promise<ChannelAccount | null>;
  listByTenant(tenantId: string): Promise<ChannelAccount[]>;
  save(account: ChannelAccount): Promise<void>;
}
