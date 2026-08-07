import { assertSameTenant, TenantContext } from "../tenancy/tenant-context";

/**
 * Ámbito de tenant para repositorios (§10.1, defensa en profundidad, capa 2).
 *
 * El `tenantId` NUNCA llega por parámetro desde una capa superior: se lee del
 * `ExecutionContext`. Así, un caso de uso no puede filtrar datos de otra
 * inmobiliaria ni por descuido ni por un id manipulado en la petición.
 *
 * Uso:
 *   this.db.client().contact.findMany({ where: { ...tenantScope(), status } })
 */
export const tenantScope = (): { tenantId: string } => ({
  tenantId: TenantContext.requireTenantId(),
});

/**
 * Ámbito para escrituras de agregados que ya llevan su `tenantId` dentro.
 *
 * Si hay contexto, verifica que coincida (evita escribir en el tenant
 * equivocado por un id arrastrado). Si no lo hay —arranque, seed, creación del
 * propio tenant— se acepta el valor del agregado, que es su fuente de verdad.
 */
export const assertWritableTenant = (aggregateTenantId: string, resourceLabel: string): void => {
  if (TenantContext.peek()) assertSameTenant(aggregateTenantId, resourceLabel);
};
