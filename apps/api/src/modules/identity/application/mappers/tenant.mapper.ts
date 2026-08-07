import type { Tenant } from "../../domain/entities/tenant";
import type { TenantView } from "../dto/tenant.dto";

/** Dominio → proyección pública. Un solo lugar que decide qué se expone. */
export const toTenantView = (tenant: Tenant): TenantView => {
  const settings = tenant.settings;
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    plan: tenant.plan,
    locale: tenant.locale,
    timezone: tenant.timezone,
    currency: tenant.currency,
    settings: {
      agentDisplayName: settings.agentDisplayName,
      tone: settings.tone,
      ...(settings.welcomeMessage ? { welcomeMessage: settings.welcomeMessage } : {}),
      ...(settings.businessHours ? { businessHours: settings.businessHours } : {}),
      maxConsecutiveFailedTurns: settings.maxConsecutiveFailedTurns,
      ...(settings.handoffEmail ? { handoffEmail: settings.handoffEmail } : {}),
      ...(settings.monthlyBudgetUsd !== undefined
        ? { monthlyBudgetUsd: settings.monthlyBudgetUsd }
        : {}),
    },
  };
};
