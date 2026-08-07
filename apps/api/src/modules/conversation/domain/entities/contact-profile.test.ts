import { describe, expect, it } from "vitest";
import { PropertyOperation } from "../value-objects/preferences";
import { slot, SlotSource } from "../value-objects/profile-slot";
import { ContactProfile } from "./contact-profile";

const t0 = new Date("2026-04-01T10:00:00.000Z");
const t1 = new Date("2026-04-01T10:05:00.000Z");

const emptyProfile = (): ContactProfile => ContactProfile.empty("t1", "ct1", t0);

describe("ContactProfile — memoria estructurada", () => {
  it("sabe qué datos faltan para poder buscar", () => {
    const profile = emptyProfile();

    expect(profile.isReadyToSearch).toBe(false);
    expect(profile.missingRequiredSlots()).toEqual(["operation", "city", "propertyType", "budget"]);

    profile.apply({
      operation: slot(PropertyOperation.RENT, SlotSource.USER, t0),
      city: slot("Medellín", SlotSource.USER, t0),
      propertyType: slot(["APARTMENT"], SlotSource.USER, t0),
      budget: slot({ max: 250_000_000, currency: "COP" }, SlotSource.USER, t0),
    });

    expect(profile.missingRequiredSlots()).toEqual([]);
    expect(profile.isReadyToSearch).toBe(true);
  });

  it("lo que dice el cliente gana sobre lo que el sistema deduce", () => {
    const profile = emptyProfile();
    profile.apply({ city: slot("Bogotá", SlotSource.USER, t0) });

    // Una inferencia posterior NO puede pisar un dato explícito del cliente.
    const changes = profile.apply({ city: slot("Medellín", SlotSource.INFERRED, t1) });

    expect(changes).toHaveLength(0);
    expect(profile.get("city")?.value).toBe("Bogotá");
  });

  it("el cliente puede corregirse y el sistema le hace caso", () => {
    const profile = emptyProfile();
    profile.apply({ city: slot("Medellín", SlotSource.USER, t0) });

    const changes = profile.apply({ city: slot("Envigado", SlotSource.USER, t1) });

    expect(changes).toHaveLength(1);
    expect(profile.get("city")?.value).toBe("Envigado");
  });

  it("una inferencia sí rellena un hueco vacío", () => {
    const profile = emptyProfile();

    const changes = profile.apply({ bedrooms: slot(3, SlotSource.INFERRED, t0) });

    expect(changes).toHaveLength(1);
    expect(profile.get("bedrooms")?.value).toBe(3);
    expect(profile.get("bedrooms")?.confidence).toBeLessThan(1);
  });

  it("un asesor humano tiene el mismo peso que el cliente y el más reciente manda", () => {
    const profile = emptyProfile();
    profile.apply({ name: slot("Ana", SlotSource.USER, t0) });

    profile.apply({ name: slot("Ana María Restrepo", SlotSource.ADVISOR, t1) });

    expect(profile.get("name")?.value).toBe("Ana María Restrepo");
  });

  it("devuelve solo los cambios que ganaron, que es lo que se audita", () => {
    const profile = emptyProfile();
    profile.apply({ city: slot("Medellín", SlotSource.USER, t0) });

    const changes = profile.apply({
      city: slot("Cali", SlotSource.INFERRED, t1), // pierde
      bedrooms: slot(2, SlotSource.USER, t1), // gana
    });

    expect(changes.map((c) => c.slot)).toEqual(["bedrooms"]);
  });

  it("las notas libres no se duplican", () => {
    const profile = emptyProfile();

    profile.addNote("Prefiere piso alto", t0);
    profile.addNote("Prefiere piso alto", t1);

    expect(profile.freeNotes).toEqual(["Prefiere piso alto"]);
  });
});
