import { describe, expect, it } from "vitest";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { billingPeriodOf } from "../../domain/policies/spend-limit.policy";
import { createHarness, HARNESS_NOW, type Harness } from "../../testing/agent-turn.harness";

/**
 * TOPE DE GASTO, de punta a punta.
 *
 * Lo que se comprueba aquí no es la aritmética —eso ya lo cubre la política
 * pura— sino lo que le pasa al CLIENTE cuando su inmobiliaria se queda sin
 * presupuesto. La respuesta correcta no es el silencio.
 */

let turnCounter = 0;

/** Un turno del cliente, como llegaría del canal. */
const runTurn = (harness: Harness, text: string) => {
  turnCounter += 1;
  harness.conversations.recordContact(text);

  return TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, () =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `turn-${String(turnCounter)}`,
      contactId: "ct1",
      text,
      correlationId: "corr-1",
    }),
  );
};

/**
 * Periodo que verá el turno.
 *
 * Se calcula con el MISMO reloj fijo del arnés, no con la fecha real: el
 * contador se indexa por el periodo del turno, y sembrar otro mes deja el tope
 * intacto sin que ningún test lo note.
 */
const PERIOD = billingPeriodOf(HARNESS_NOW, "America/Bogota");

describe("Tope de gasto por inmobiliaria", () => {
  it("con el tope agotado pasa la conversación a una persona, no se calla", async () => {
    const harness = createHarness({ monthlyBudgetUsd: 10 });
    harness.usage.seed(PERIOD, 10);

    const result = await runTurn(harness, "busco apartamento en Medellín");

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    /*
     * Un agente que se queda mudo porque su inmobiliaria se pasó del
     * presupuesto parece un producto roto. Uno que dice "te paso con un asesor"
     * parece un producto.
     */
    expect(result.value.status).toBe("ESCALATED");
    expect(result.value.reply.length).toBeGreaterThan(0);
  });

  it("no llama al modelo cuando el tope está agotado", async () => {
    const harness = createHarness({ monthlyBudgetUsd: 10 });
    harness.usage.seed(PERIOD, 10);

    await runTurn(harness, "busco apartamento en Medellín");

    const run = harness.runs.runs[0];
    // Coste cero: la comprobación va ANTES de gastar, que es el único momento
    // en el que sirve de algo.
    expect(run?.usage.promptTokens).toBe(0);
    expect(run?.usage.completionTokens).toBe(0);
  });

  it("con holgura atiende con normalidad", async () => {
    const harness = createHarness({ monthlyBudgetUsd: 100 });
    harness.usage.seed(PERIOD, 1);

    const result = await runTurn(harness, "hola");

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe("COMPLETED");
  });

  it("sin tope configurado no bloquea nunca", async () => {
    const harness = createHarness();
    harness.usage.seed(PERIOD, 999_999);

    const result = await runTurn(harness, "hola");

    /*
     * A una inmobiliaria que olvidó configurar el límite no se le puede apagar
     * el agente: el fallo parecería del producto. Quien quiere apagarlo, lo
     * apaga.
     */
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe("COMPLETED");
  });

  it("anota el consumo del turno en el periodo", async () => {
    const harness = createHarness();

    await runTurn(harness, "hola");

    const spend = await harness.usage.spendIn(PERIOD);
    expect(spend.turns).toBe(1);
    // El simulador no cuesta nada, pero sí consume tokens: es lo que hace que
    // el contador se pueda probar sin pagar.
    expect(spend.promptTokens).toBeGreaterThan(0);
    expect(spend.spentUsd).toBe(0);
  });

  it("un escalamiento sin llamar al modelo no anota consumo", async () => {
    const harness = createHarness();

    // Pedir un asesor se resuelve con reglas, sin tocar el proveedor.
    await runTurn(harness, "quiero hablar con una persona");

    const spend = await harness.usage.spendIn(PERIOD);
    expect(spend.promptTokens).toBe(0);
  });

  it("anota el consumo aunque el turno reviente a mitad", async () => {
    /*
     * El contador vive en un `finally` justamente por esto: si un turno llama
     * al modelo y luego falla al entregar, ya se pagó. Anotar solo el camino
     * feliz dejaría fuera los turnos que se repiten cuando algo va mal — que
     * son los que disparan una factura.
     */
    const harness = createHarness();
    harness.conversations.failOnReply = true;

    await expect(runTurn(harness, "busco apartamento en Medellín")).rejects.toThrow();

    const spend = await harness.usage.spendIn(PERIOD);
    expect(spend.promptTokens).toBeGreaterThan(0);
    expect(spend.turns).toBe(1);
  });
});
