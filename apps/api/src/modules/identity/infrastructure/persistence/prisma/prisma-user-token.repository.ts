import type { Database } from "../../../../../platform/database/prisma";
import { UserToken, type UserTokenPurpose } from "../../../domain/entities/user-token";
import type { UserTokenRepository } from "../../../domain/repositories/user-token.repository";

/**
 * Repositorio de enlaces de un solo uso.
 *
 * Sin `tenantScope()`, y es la misma excepción justificada que las sesiones: el
 * token es lo que RESUELVE el tenant. La búsqueda va por su hash —único en toda
 * la plataforma y de 256 bits de entropía—, así que no hay nada que enumerar.
 */
export class PrismaUserTokenRepository implements UserTokenRepository {
  constructor(private readonly db: Database) {}

  async save(token: UserToken): Promise<void> {
    const props = token.snapshot();

    await this.db.client().userToken.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        tenantId: props.tenantId,
        userId: props.userId,
        purpose: props.purpose,
        tokenHash: props.tokenHash,
        expiresAt: props.expiresAt,
        usedAt: props.usedAt ?? null,
        createdAt: props.createdAt,
      },
      update: { usedAt: props.usedAt ?? null },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<UserToken | null> {
    const row = await this.db.client().userToken.findUnique({ where: { tokenHash } });
    if (!row) return null;

    return UserToken.rehydrate({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      purpose: row.purpose,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      ...(row.usedAt ? { usedAt: row.usedAt } : {}),
      createdAt: row.createdAt,
    });
  }

  async invalidateOpen(userId: string, purpose: UserTokenPurpose, now: Date): Promise<void> {
    // Se marcan como usados en vez de borrarse: así el enlace viejo responde
    // "ya no vale" y queda constancia de que se emitió.
    await this.db.client().userToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.db.client().userToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return result.count;
  }
}
