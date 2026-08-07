import type { Database } from "../../../../../platform/database/prisma";
import type { Session } from "../../../domain/entities/session";
import type { SessionRepository } from "../../../domain/repositories/session.repository";
import { sessionToDomain, sessionToPersistence } from "./identity.prisma-mapper";

/**
 * Repositorio de sesiones.
 *
 * Sin `tenantScope()`, y es la excepción justificada del módulo: la sesión es
 * lo que RESUELVE el tenant. La búsqueda va por el hash del token, único en
 * toda la plataforma y de 256 bits de entropía, así que no hay nada que
 * enumerar ni que adivinar.
 */
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async save(session: Session): Promise<void> {
    const data = sessionToPersistence(session);

    await this.db.client().session.upsert({
      where: { id: data.id },
      create: data,
      update: {
        lastSeenAt: data.lastSeenAt,
        expiresAt: data.expiresAt,
        revokedAt: data.revokedAt,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = await this.db.client().session.findUnique({ where: { tokenHash } });
    return row ? sessionToDomain(row) : null;
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db.client().session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await this.db.client().session.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return result.count;
  }
}
