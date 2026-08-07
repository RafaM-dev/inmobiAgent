import { describe, expect, it } from "vitest";
import { moneyFromMajor } from "../../../conversation";
import { extractSlots } from "./spanish-slot-rules";

describe("extractSlots — así escribe la gente por WhatsApp", () => {
  it("«busco apto en laureles hasta 450 millones»", () => {
    const slots = extractSlots("busco apto en laureles hasta 450 millones");

    expect(slots.propertyType).toEqual(["APARTMENT"]);
    expect(slots.neighborhoods).toEqual(["Laureles"]);
    expect(slots.budget).toEqual({ max: moneyFromMajor(450_000_000, "COP"), currency: "COP" });
  });

  it("«arriendo de 2 habitaciones en envigado, máximo 1.800.000»", () => {
    const slots = extractSlots("arriendo de 2 habitaciones en envigado, maximo 1.800.000");

    expect(slots.operation).toBe("RENT");
    expect(slots.bedrooms).toBe(2);
    expect(slots.city).toBe("Envigado");
    expect(slots.budget).toEqual({ max: moneyFromMajor(1_800_000, "COP"), currency: "COP" });
  });

  it("«quiero comprar casa de tres alcobas y dos baños en Medellín»", () => {
    const slots = extractSlots("quiero comprar casa de tres alcobas y dos baños en Medellín");

    expect(slots.operation).toBe("SALE");
    expect(slots.propertyType).toEqual(["HOUSE"]);
    expect(slots.bedrooms).toBe(3);
    expect(slots.bathrooms).toBe(2);
    expect(slots.city).toBe("Medellín");
  });

  it("«entre 300 y 450 millones» captura los dos extremos", () => {
    const slots = extractSlots("presupuesto entre 300 y 450 millones");

    expect(slots.budget).toEqual({
      min: moneyFromMajor(300_000_000, "COP"),
      max: moneyFromMajor(450_000_000, "COP"),
      currency: "COP",
    });
  });

  it("«apartaestudio» no es un apartamento", () => {
    expect(extractSlots("busco apartaestudio").propertyType).toEqual(["STUDIO"]);
  });

  it("no confunde un número de habitaciones con dinero", () => {
    const slots = extractSlots("necesito algo de 3 habitaciones");

    expect(slots.bedrooms).toBe(3);
    expect(slots.budget).toBeUndefined();
  });

  it("captura el nombre y respeta su escritura", () => {
    expect(extractSlots("hola, me llamo Ana María").name).toBe("Ana María");
    expect(extractSlots("soy Carlos y busco apartamento").name).toBe("Carlos");
  });

  it("entiende la urgencia", () => {
    expect(extractSlots("lo necesito ya").timeline).toBe("now");
    expect(extractSlots("estoy mirando sin afan").timeline).toBe("exploring");
  });

  it("no inventa nada cuando el mensaje no dice nada", () => {
    expect(extractSlots("hola buenas tardes")).toEqual({});
    expect(extractSlots("gracias!")).toEqual({});
  });

  it("es determinista: el mismo texto da siempre el mismo resultado", () => {
    const text = "busco apartamento en el poblado hasta 600 millones, 3 habitaciones";

    expect(extractSlots(text)).toEqual(extractSlots(text));
  });
});
