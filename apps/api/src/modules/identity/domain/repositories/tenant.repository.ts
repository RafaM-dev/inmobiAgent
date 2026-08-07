import type { Tenant } from "../entities/tenant";

/**
 * Puerto de persistencia del agregado Tenant.
 *
 * Vive en el dominio y lo implementa infrastructure: la regla de dependencia
 * apunta hacia adentro. El caso de uso depende de esta interfaz, así que se
 * testea con una implementación en memoria sin tocar Postgres.
 *
 * Nota deliberada: los métodos NO reciben `tenantId` de scope porque el tenant
 * *es* el recurso. Es el único repositorio del sistema con esa propiedad.
 */
export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  save(tenant: Tenant): Promise<void>;
  list(limit: number): Promise<Tenant[]>;
}
