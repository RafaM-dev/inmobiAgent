import type { TenantView } from "../dto/tenant.dto";

/**
 * Puerto público de `identity` hacia el resto del sistema.
 *
 * Es intencionadamente diminuto y de solo lectura. Otros módulos necesitan
 * saber *qué* tenant es y cómo se comporta; nunca necesitan crearlo, cambiarlo
 * ni conocer su agregado. Así, el día que `identity` sea un servicio aparte,
 * esta interfaz se implementa con un cliente HTTP y nadie más cambia.
 */
export interface TenantDirectory {
  findById(tenantId: string): Promise<TenantView | null>;
  findBySlug(slug: string): Promise<TenantView | null>;
  /**
   * Devuelve el tenant o falla si no existe o está suspendido.
   * Es la comprobación que hace todo punto de entrada antes de procesar nada.
   */
  requireActive(tenantId: string): Promise<TenantView>;
}
