import { describe, expect, it } from "vitest";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { createHarness, TENANT, type Harness } from "../../testing/agent-turn.harness";

/**
 * Cuando el agente pasa una conversación a una persona, esa persona SE ENTERA.
 *
 * Este archivo existe por un fallo real: el escalado funcionaba perfectamente
 * —el bot se callaba, el cliente recibía su mensaje, el evento se publicaba— y
 * no había ni un solo consumidor de ese evento. La conversación se quedaba
 * muerta hasta que alguien abriera el inbox por casualidad.
 *
 * Los tests unitarios del handler no lo habrían encontrado: el handler no
 * existía, y un handler que nadie registra pasa todos sus tests. Por eso esta
 * comprobación es de FLUJO y arranca donde arranca el problema —un cliente
 * escribiendo— en lugar de invocar el handler a mano.
 */

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, fn);

let turnCounter = 0;

const say = async (harness: Harness, text: string): Promise<void> => {
  turnCounter += 1;
  harness.conversations.recordContact(text);

  const result = await inTenant(() =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `turn-${String(turnCounter)}`,
      contactId: "ct1",
      text,
      correlationId: "corr-1",
    }),
  );

  if (!isOk(result)) throw new Error("el turno debería completarse");
};

/** La demo no trae correo de avisos; aquí hace falta uno. */
const conAviso = (): Harness =>
  createHarness({
    tenant: {
      ...TENANT,
      settings: { ...TENANT.settings, handoffEmail: "asesor@inmobiliaria-demo.co" },
    },
  });

describe("Un escalado no se queda mudo", () => {
  it("pedir hablar con una persona genera un aviso al correo de la inmobiliaria", async () => {
    const harness = conAviso();

    await say(harness, "quiero hablar con un asesor humano");

    expect(harness.notifier.sent).toHaveLength(1);
    expect(harness.notifier.last?.to).toBe("asesor@inmobiliaria-demo.co");
  });

  it("el aviso lleva el enlace al hilo, que es lo que se pulsa", async () => {
    const harness = conAviso();

    await say(harness, "quiero hablar con un asesor humano");

    expect(harness.notifier.last?.body).toContain("https://panel.pruebas/inbox/c1");
  });

  it("el aviso dice POR QUÉ, no solo que pasó algo", async () => {
    const harness = conAviso();

    await say(harness, "quiero hablar con un asesor humano");

    expect(harness.notifier.last?.body).toContain("lo ha pedido expresamente");
  });

  it("una inmobiliaria sin correo configurado no rompe el escalado", async () => {
    // El tenant por defecto no tiene `handoffEmail`.
    const harness = createHarness();

    await say(harness, "quiero hablar con un asesor humano");

    expect(harness.notifier.sent).toHaveLength(0);
    // Lo que importa: el cliente recibió su respuesta igual.
    expect(harness.conversations.replies.at(-1)?.blocks.length).toBeGreaterThan(0);
  });

  it("una conversación normal no molesta a nadie", async () => {
    const harness = conAviso();

    await say(harness, "hola, busco apartamento en Medellín para arrendar");

    expect(harness.notifier.sent).toHaveLength(0);
  });
});
