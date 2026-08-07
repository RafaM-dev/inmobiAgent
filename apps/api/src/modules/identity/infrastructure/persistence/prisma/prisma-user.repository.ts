import type { Database } from "../../../../../platform/database/prisma";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { User } from "../../../domain/entities/user";
import type { UserRepository } from "../../../domain/repositories/user.repository";
import { userToDomain, userToPersistence } from "./identity.prisma-mapper";

/**
 * Repositorio de usuarios internos.
 *
 * Toda lectura lleva `tenantScope()`: el filtro por inmobiliaria no depende de
 * que el caso de uso se acuerde de ponerlo.
 */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.client().user.findFirst({ where: { id, ...tenantScope() } });
    return row ? userToDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.client().user.findUnique({
      where: { tenantId_email: { tenantId: tenantScope().tenantId, email: email.toLowerCase() } },
    });
    return row ? userToDomain(row) : null;
  }

  /** Camino de login: el tenant llega explícito porque aún no hay contexto. */
  async findByEmailInTenant(tenantId: string, email: string): Promise<User | null> {
    const row = await this.db.client().user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
    return row ? userToDomain(row) : null;
  }

  /** Camino de validación de sesión: el tenant sale de la propia sesión. */
  async findByIdUnscoped(id: string): Promise<User | null> {
    const row = await this.db.client().user.findUnique({ where: { id } });
    return row ? userToDomain(row) : null;
  }

  async listByTenant(): Promise<User[]> {
    const rows = await this.db.client().user.findMany({
      where: tenantScope(),
      orderBy: { displayName: "asc" },
    });
    return rows.map(userToDomain);
  }

  async save(user: User): Promise<void> {
    assertWritableTenant(user.tenantId, "usuario");
    const data = userToPersistence(user);
    await this.db.client().user.upsert({
      where: { id: data.id },
      create: data,
      update: {
        displayName: data.displayName,
        role: data.role,
        status: data.status,
        passwordHash: data.passwordHash,
      },
    });
  }
}
