import { describe, expect, it } from "vitest";
import { slot, SlotSource, type ProfileSlots } from "../../../conversation";
import { MAX_QUESTIONS_PER_TURN, composeQuestions, planDiscovery } from "./discovery.policy";

const now = new Date("2026-06-01T12:00:00.000Z");

describe("planDiscovery", () => {
  it("con un perfil vacío pregunta primero la operación y la ciudad", () => {
    const plan = planDiscovery({});

    expect(plan.readyToSearch).toBe(false);
    expect(plan.ask).toEqual(["operation", "city"]);
  });

  it("nunca pregunta más de dos cosas en un mensaje", () => {
    const plan = planDiscovery({});

    expect(plan.ask.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_TURN);
  });

  it("no vuelve a preguntar lo que el cliente ya dijo", () => {
    const slots: ProfileSlots = {
      operation: slot("RENT", SlotSource.USER, now),
      city: slot("Medellín", SlotSource.USER, now),
    };

    expect(planDiscovery(slots).ask).toEqual(["propertyType", "budget"]);
  });

  it("con los datos obligatorios completos, deja de preguntar y pasa a buscar", () => {
    const slots: ProfileSlots = {
      operation: slot("SALE", SlotSource.USER, now),
      city: slot("Medellín", SlotSource.USER, now),
      propertyType: slot(["APARTMENT"], SlotSource.USER, now),
      budget: slot({ max: 450_000_000, currency: "COP" }, SlotSource.USER, now),
    };

    const plan = planDiscovery(slots);

    expect(plan.readyToSearch).toBe(true);
    expect(plan.ask).toEqual([]);
    // Habitaciones sigue faltando, pero no bloquea la búsqueda.
    expect(plan.missing).toEqual(["bedrooms"]);
  });

  it("el presupuesto se pregunta al final, no de entrada", () => {
    const plan = planDiscovery({});

    expect(plan.ask).not.toContain("budget");
    expect(plan.missing.indexOf("budget")).toBeGreaterThan(plan.missing.indexOf("city"));
  });

  it("compone las preguntas en español natural", () => {
    expect(composeQuestions(["operation", "city"])).toBe(
      "¿Estás buscando para comprar o para arrendar? ¿En qué ciudad la estás buscando?",
    );
    expect(composeQuestions([])).toBe("");
  });
});
