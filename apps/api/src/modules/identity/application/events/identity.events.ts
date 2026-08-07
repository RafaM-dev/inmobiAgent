import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `identity`.
 *
 * Son parte del contrato público del módulo: cualquier otro módulo puede
 * suscribirse a ellos, y ese es el único acoplamiento permitido hacia
 * `identity` además de sus puertos.
 */

export interface TenantCreatedPayload {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: string;
  readonly locale: string;
  readonly timezone: string;
  readonly currency: string;
}

export const TenantCreated = defineEvent<TenantCreatedPayload>("identity.tenant_created");

export interface TenantStatusChangedPayload {
  readonly tenantId: string;
  readonly status: "ACTIVE" | "SUSPENDED";
}

export const TenantStatusChanged = defineEvent<TenantStatusChangedPayload>(
  "identity.tenant_status_changed",
);
