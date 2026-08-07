import { describe, expect, it } from "vitest";
import { billingPeriodOf, decideSpend, SpendVerdict } from "./spend-limit.policy";

describe("decideSpend", () => {
  it("deja pasar mientras quede holgura", () => {
    expect(decideSpend({ spentUsd: 10, limitUsd: 100 }).verdict).toBe(SpendVerdict.ALLOW);
  });

  it("avisa a partir del 80 % del tope, sin dejar de atender", () => {
    const decision = decideSpend({ spentUsd: 80, limitUsd: 100 });

    // Avisar y seguir atendiendo: cortar al 80 % sería inventarse un tope.
    expect(decision.verdict).toBe(SpendVerdict.WARN);
    expect(decision.ratio).toBeCloseTo(0.8);
  });

  it("bloquea justo AL alcanzar el tope, no al pasarlo", () => {
    /*
     * Con `>` en vez de `>=` siempre se colaría un turno más, y "el tope nunca
     * se respeta del todo" es lo que hace que nadie confíe en el número.
     */
    expect(decideSpend({ spentUsd: 100, limitUsd: 100 }).verdict).toBe(SpendVerdict.BLOCK);
    expect(decideSpend({ spentUsd: 100.01, limitUsd: 100 }).verdict).toBe(SpendVerdict.BLOCK);
  });

  it("un tope de cero significa SIN tope, no `no gastes nada`", () => {
    /*
     * Es la lectura que evita el peor accidente: a una inmobiliaria que olvidó
     * configurar el límite se le apagaría el agente de golpe, y el fallo
     * parecería del producto. Quien quiere apagarlo, lo apaga.
     */
    expect(decideSpend({ spentUsd: 5000, limitUsd: 0 }).verdict).toBe(SpendVerdict.ALLOW);
    expect(decideSpend({ spentUsd: 5000, limitUsd: -1 }).verdict).toBe(SpendVerdict.ALLOW);
  });

  it("informa de cuánto se lleva gastado para poder decirlo en el aviso", () => {
    const decision = decideSpend({ spentUsd: 120, limitUsd: 100 });

    expect(decision.spentUsd).toBe(120);
    expect(decision.limitUsd).toBe(100);
    expect(decision.ratio).toBeCloseTo(1.2);
  });
});

describe("billingPeriodOf", () => {
  it("corta el mes en la medianoche de la inmobiliaria, no en la de UTC", () => {
    // 1 de septiembre, 02:00 UTC = 31 de agosto, 21:00 en Bogotá.
    const instant = new Date("2026-09-01T02:00:00.000Z");

    expect(billingPeriodOf(instant, "America/Bogota")).toBe("2026-08");
    expect(billingPeriodOf(instant, "UTC")).toBe("2026-09");
  });

  it("es estable dentro del mismo mes local", () => {
    expect(billingPeriodOf(new Date("2026-03-01T05:00:00.000Z"), "America/Bogota")).toBe("2026-03");
    expect(billingPeriodOf(new Date("2026-03-31T23:00:00.000Z"), "America/Bogota")).toBe("2026-03");
  });
});
