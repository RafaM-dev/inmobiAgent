import { ForbiddenError, NotFoundError } from "../../../../platform/errors/app-error";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { TenantView } from "../dto/tenant.dto";
import { toTenantView } from "../mappers/tenant.mapper";
import type { TenantDirectory } from "../ports/tenant-directory";

/**
 * Implementación del directorio de tenants sobre el repositorio local.
 *
 * Incluye una caché en memoria con TTL corto: `requireActive` se ejecuta en
 * cada mensaje entrante de cada canal, y es una lectura que cambia muy poco.
 * El TTL es deliberadamente bajo para que suspender un tenant surta efecto
 * en segundos sin necesidad de invalidación distribuida.
 */
export class TenantDirectoryService implements TenantDirectory {
  private readonly cache = new Map<string, { value: TenantView; expiresAt: number }>();

  constructor(
    private readonly deps: {
      tenants: TenantRepository;
      clock: { nowMs(): number };
      cacheTtlMs?: number;
    },
  ) {}

  private get ttl(): number {
    return this.deps.cacheTtlMs ?? 30_000;
  }

  async findById(tenantId: string): Promise<TenantView | null> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.deps.clock.nowMs()) return cached.value;

    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) return null;

    const view = toTenantView(tenant);
    this.cache.set(tenantId, { value: view, expiresAt: this.deps.clock.nowMs() + this.ttl });
    return view;
  }

  async findBySlug(slug: string): Promise<TenantView | null> {
    const tenant = await this.deps.tenants.findBySlug(slug);
    return tenant ? toTenantView(tenant) : null;
  }

  async requireActive(tenantId: string): Promise<TenantView> {
    const tenant = await this.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant", tenantId);
    if (tenant.status !== "ACTIVE") {
      throw new ForbiddenError(`La cuenta "${tenant.slug}" está suspendida`);
    }
    return tenant;
  }

  /** Lo invoca `identity` tras cambiar un tenant. No es parte del puerto. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
