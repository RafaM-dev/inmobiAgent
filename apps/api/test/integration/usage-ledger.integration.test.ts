import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaUsageLedger } from "../../src/modules/agent/infrastructure/persistence/prisma/prisma-usage-ledger";
import { asTenant } from "../support/fixtures";
import { withDatabase, type DatabaseContext } from "../support/integration-harness";

/**
 * CONTADOR DE GASTO contra Postgres de verdad.
 *
 * La suma se hace en la base con `ON CONFLICT … DO UPDATE`, y esa decisión solo
 * se puede comprobar aquí: un doble en memoria suma en un único proceso y
 * siempre da bien. Lo que hay que demostrar es que **dos workers sumando a la
 * vez no pierden un incremento** — porque un contador que pierde incrementos
 * reporta menos gasto del real, y un tope construido sobre él no protege nada.
 */
describe("PrismaUsageLedger (Postgres real)", () => {
  let context: DatabaseContext;
  let ledger: PrismaUsageLedger;

  const usage = (cost: number) => ({
    promptTokens: 100,
    completionTokens: 50,
    estimatedCostUsd: cost,
  });

  beforeAll(async () => {
    context = await withDatabase();
    ledger = new PrismaUsageLedger(context.database);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it("empieza en cero sin fila: es el primer turno del mes", async () => {
    const spend = await asTenant("t1", () => ledger.spendIn("2026-08"));

    // No es un error ni un caso raro: le pasa a cada inmobiliaria cada mes.
    expect(spend).toEqual({
      period: "2026-08",
      spentUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      turns: 0,
    });
  });

  it("acumula turno a turno en vez de sustituir", async () => {
    await asTenant("t1", async () => {
      await ledger.record({ period: "2026-08", usage: usage(0.01) });
      await ledger.record({ period: "2026-08", usage: usage(0.02) });
    });

    const spend = await asTenant("t1", () => ledger.spendIn("2026-08"));

    expect(spend.spentUsd).toBeCloseTo(0.03, 6);
    expect(spend.promptTokens).toBe(200);
    expect(spend.turns).toBe(2);
  });

  it("veinte escrituras simultáneas no pierden ni un incremento", async () => {
    /*
     * ESTE es el test que justifica el SQL crudo.
     *
     * Con un leer-modificar-escribir desde Node, varias réplicas del worker
     * cerrando turnos a la vez se pisan y el total queda por debajo del real —
     * justo el error que hace inútil un tope de gasto. La sentencia
     * `ON CONFLICT … DO UPDATE SET x = tabla.x + excluido.x` es atómica.
     */
    await asTenant("t1", async () => {
      await Promise.all(
        Array.from({ length: 20 }, () => ledger.record({ period: "2026-08", usage: usage(0.05) })),
      );
    });

    const spend = await asTenant("t1", () => ledger.spendIn("2026-08"));

    expect(spend.turns).toBe(20);
    expect(spend.spentUsd).toBeCloseTo(1, 6);
    expect(spend.promptTokens).toBe(2000);
  });

  it("separa periodos: el mes nuevo empieza limpio", async () => {
    await asTenant("t1", async () => {
      await ledger.record({ period: "2026-08", usage: usage(5) });
      await ledger.record({ period: "2026-09", usage: usage(1) });
    });

    expect((await asTenant("t1", () => ledger.spendIn("2026-08"))).spentUsd).toBeCloseTo(5, 6);
    expect((await asTenant("t1", () => ledger.spendIn("2026-09"))).spentUsd).toBeCloseTo(1, 6);
  });

  it("el gasto de una inmobiliaria no se ve desde otra", async () => {
    await asTenant("alfa", () => ledger.record({ period: "2026-08", usage: usage(9) }));

    const deBeta = await asTenant("beta", () => ledger.spendIn("2026-08"));

    // Si el contador se filtrara entre inmobiliarias, a una se le apagaría el
    // agente por lo que gastó la otra.
    expect(deBeta.spentUsd).toBe(0);
    expect((await asTenant("alfa", () => ledger.spendIn("2026-08"))).spentUsd).toBeCloseTo(9, 6);
  });

  it("conserva los céntimos: un turno cuesta millonésimas de dólar", async () => {
    await asTenant("t1", () =>
      ledger.record({ period: "2026-08", usage: usage(0.000123) }),
    );

    const spend = await asTenant("t1", () => ledger.spendIn("2026-08"));

    // Redondear a céntimos convertiría en cero el coste de casi todos los
    // turnos, y el tope no se alcanzaría jamás.
    expect(spend.spentUsd).toBeCloseTo(0.000123, 6);
  });
});
