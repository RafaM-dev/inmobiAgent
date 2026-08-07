import type { Database } from "../../../../../platform/database/prisma";
import type { Tenant } from "../../../domain/entities/tenant";
import type { TenantRepository } from "../../../domain/repositories/tenant.repository";
import { tenantToDomain, tenantToPersistence } from "./identity.prisma-mapper";

/**
 * Repositorio de tenants sobre Prisma.
 *
 * Pide el cliente a `Database.client()` en cada operación —nunca lo guarda en
 * un campo— porque así se une automáticamente a la transacción ambiental que
 * haya abierto el caso de uso.
 */
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.db.client().tenant.findUnique({ where: { id } });
    return row ? tenantToDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.db.client().tenant.findUnique({ where: { slug } });
    return row ? tenantToDomain(row) : null;
  }

  async save(tenant: Tenant): Promise<void> {
    const data = tenantToPersistence(tenant);
    // Upsert: el agregado no distingue "nuevo" de "modificado"; el repositorio sí.
    await this.db.client().tenant.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        status: data.status,
        plan: data.plan,
        locale: data.locale,
        timezone: data.timezone,
        currency: data.currency,
        settings: data.settings,
      },
    });
  }

  async list(limit: number): Promise<Tenant[]> {
    const rows = await this.db.client().tenant.findMany({
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map(tenantToDomain);
  }
}
