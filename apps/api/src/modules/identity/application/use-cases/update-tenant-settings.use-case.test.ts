import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { isErr, isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { Tenant } from "../../domain/entities/tenant";
import { AgentTone, TenantSettings } from "../../domain/value-objects/tenant-settings";
import { InMemoryTenantRepository } from "../../testing/in-memory-identity.repositories";
import { UpdateTenantSettingsUseCase } from "./update-tenant-settings.use-case";

const NOW = new Date("2026-03-01T12:00:00.000Z");

const setup = () => {
  const tenants = new InMemoryTenantRepository();

  const tenant = Tenant.create({
    id: "tenant-1",
    slug: "inmobiliaria-demo",
    name: "Inmobiliaria Demo",
    now: NOW,
    settings: TenantSettings.create({
      agentDisplayName: "Asistente",
      tone: AgentTone.CERCANO,
      welcomeMessage: "Hola, ¿en qué te ayudo?",
      businessHours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" },
      maxConsecutiveFailedTurns: 2,
    }),
  });
  tenants.items.set(tenant.id, tenant);

  const useCase = new UpdateTenantSettingsUseCase({
    tenants,
    unitOfWork: new NoopUnitOfWork(),
    clock: new FixedClock(NOW),
  });

  const run = <T>(fn: () => Promise<T>, tenantId = "tenant-1"): Promise<T> =>
    TenantContext.run({ tenantId, correlationId: "corr-1", source: "http" }, fn);

  return { useCase, tenants, tenant, run };
};

describe("UpdateTenantSettingsUseCase", () => {
  it("cambia solo lo que llega y deja intacto el resto", async () => {
    const { useCase, run } = setup();

    const result = await run(() => useCase.execute({ tone: AgentTone.FORMAL }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.settings.tone).toBe(AgentTone.FORMAL);
    // Nadie tocó estos campos: enviar el objeto entero desde el navegador
    // haría que dos asesores editando a la vez se pisaran lo que no tocaron.
    expect(result.value.settings.agentDisplayName).toBe("Asistente");
    expect(result.value.settings.welcomeMessage).toBe("Hola, ¿en qué te ayudo?");
    expect(result.value.settings.businessHours?.from).toBe("09:00");
  });

  it("toma el tenant del contexto, nunca del comando", async () => {
    const { useCase, tenants, run } = setup();

    // El contexto apunta a un tenant que no existe: aunque la inmobiliaria
    // "tenant-1" sí exista, no hay forma de alcanzarla desde otra sesión.
    const result = await run(() => useCase.execute({ tone: AgentTone.NEUTRO }), "tenant-ajeno");

    expect(isErr(result)).toBe(true);
    expect(tenants.items.get("tenant-1")?.settings.tone).toBe(AgentTone.CERCANO);
  });

  it("rechaza un horario imposible y no persiste nada", async () => {
    const { useCase, tenants, run } = setup();

    await expect(
      run(() =>
        useCase.execute({ businessHours: { days: [1], from: "25:00", to: "18:00" } }),
      ),
    ).rejects.toThrow(/HH:mm/);

    expect(tenants.items.get("tenant-1")?.settings.businessHours?.from).toBe("09:00");
  });

  it("permite borrar un ajuste opcional enviándolo vacío", async () => {
    const { useCase, run } = setup();

    const result = await run(() => useCase.execute({ welcomeMessage: "   " }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Un texto en blanco es "sin valor", no un saludo formado por espacios.
    expect(result.value.settings.welcomeMessage).toBeUndefined();
  });
});
