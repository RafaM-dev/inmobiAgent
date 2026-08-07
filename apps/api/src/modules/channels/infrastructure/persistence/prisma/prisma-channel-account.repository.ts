import type { ChannelAccount as PrismaChannelAccount } from "../../../../../generated/prisma/client";
import type { Database } from "../../../../../platform/database/prisma";
import { toJson } from "../../../../../platform/database/json";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import { ChannelAccount } from "../../../domain/entities/channel-account";
import type { ChannelAccountRepository } from "../../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../../domain/value-objects/channel-type";

const toDomain = (row: PrismaChannelAccount): ChannelAccount =>
  ChannelAccount.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    channelType: row.channelType,
    externalId: row.externalId,
    displayName: row.displayName,
    status: row.status,
    config: (row.config ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaChannelAccountRepository implements ChannelAccountRepository {
  constructor(private readonly db: Database) {}

  /**
   * Acotada por tenant, como todas las lecturas por id del sistema.
   *
   * Estaba sin acotar y lo destapó un test de integración. No era explotable
   * —sus dos llamadores pasan un id que sale del estado interno, no de una
   * petición— pero rompía la garantía en la que se apoya el resto: que ningún
   * repositorio devuelve datos de otra inmobiliaria aunque le den su id. Una
   * defensa en profundidad con un agujero no es defensa en profundidad; es
   * suerte.
   */
  async findById(id: string): Promise<ChannelAccount | null> {
    const row = await this.db.client().channelAccount.findFirst({
      where: { ...tenantScope(), id },
    });
    return row ? toDomain(row) : null;
  }

  /**
   * Sin ámbito de tenant a propósito: esta es la consulta que *descubre* el
   * tenant a partir de la cuenta por la que entró el mensaje (docs §7.1).
   */
  async findByExternalId(
    channelType: ChannelType,
    externalId: string,
  ): Promise<ChannelAccount | null> {
    const row = await this.db.client().channelAccount.findUnique({
      where: { channelType_externalId: { channelType, externalId } },
    });
    return row ? toDomain(row) : null;
  }

  async listByTenant(tenantId: string): Promise<ChannelAccount[]> {
    const rows = await this.db.client().channelAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async save(account: ChannelAccount): Promise<void> {
    assertWritableTenant(account.tenantId, "cuenta de canal");
    const data = account.snapshot();
    await this.db.client().channelAccount.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        channelType: data.channelType,
        externalId: data.externalId,
        displayName: data.displayName,
        status: data.status,
        config: toJson(data.config),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      update: {
        displayName: data.displayName,
        status: data.status,
        config: toJson(data.config),
      },
    });
  }
}
