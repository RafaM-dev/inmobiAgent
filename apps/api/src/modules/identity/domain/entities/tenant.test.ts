import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../platform/errors/app-error";
import { TenantSettings } from "../value-objects/tenant-settings";
import { Tenant, TenantStatus } from "./tenant";

const now = new Date("2026-01-01T10:00:00.000Z");
const base = { id: "t1", slug: "inmobiliaria-medellin", name: "Inmobiliaria Medellín", now };

describe("Tenant", () => {
  it("aplica valores por defecto coherentes con el mercado objetivo", () => {
    const tenant = Tenant.create(base);

    expect(tenant.locale).toBe("es-CO");
    expect(tenant.timezone).toBe("America/Bogota");
    expect(tenant.currency).toBe("COP");
    expect(tenant.status).toBe(TenantStatus.ACTIVE);
    expect(tenant.settings.agentDisplayName).toBe("Asistente");
  });

  it("rechaza identificadores que no sean kebab-case", () => {
    expect(() => Tenant.create({ ...base, slug: "Inmobiliaria Medellín" })).toThrow(DomainError);
    expect(() => Tenant.create({ ...base, slug: "con_guion_bajo" })).toThrow(DomainError);
  });

  it("normaliza el slug y la moneda", () => {
    const tenant = Tenant.create({ ...base, slug: "  MI-INMOBILIARIA  ", currency: "usd" });

    expect(tenant.slug).toBe("mi-inmobiliaria");
    expect(tenant.currency).toBe("USD");
  });

  it("rechaza monedas que no sean ISO 4217", () => {
    expect(() => Tenant.create({ ...base, currency: "pesos" })).toThrow(DomainError);
  });

  it("suspender y reactivar es idempotente y actualiza la marca de tiempo", () => {
    const tenant = Tenant.create(base);
    const later = new Date("2026-01-02T10:00:00.000Z");

    tenant.suspend(later);
    expect(tenant.isActive).toBe(false);
    expect(tenant.updatedAt).toEqual(later);

    const evenLater = new Date("2026-01-03T10:00:00.000Z");
    tenant.suspend(evenLater);
    expect(tenant.updatedAt).toEqual(later); // no hubo cambio de estado

    tenant.activate(evenLater);
    expect(tenant.isActive).toBe(true);
    expect(tenant.updatedAt).toEqual(evenLater);
  });

  it("los settings son inmutables: `with` devuelve una instancia nueva", () => {
    const settings = TenantSettings.create({ agentDisplayName: "Sofía" });
    const changed = settings.with({ agentDisplayName: "Camila" });

    expect(settings.agentDisplayName).toBe("Sofía");
    expect(changed.agentDisplayName).toBe("Camila");
    expect(changed).not.toBe(settings);
  });

  it("valida el horario de atención", () => {
    expect(() =>
      TenantSettings.create({ businessHours: { days: [1, 2], from: "9am", to: "18:00" } }),
    ).toThrow(DomainError);

    expect(() =>
      TenantSettings.create({ businessHours: { days: [7], from: "09:00", to: "18:00" } }),
    ).toThrow(DomainError);
  });
});
