import { describe, expect, it } from "vitest";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ReplyBlock } from "../../../channels";
import { PropertyShown } from "../../../catalog";
import { createHarness } from "../../testing/agent-turn.harness";

const run = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, fn);

const turn = (text: string) => ({
  conversationId: "c1",
  turnId: `turn-${text.slice(0, 6)}`,
  contactId: "ct1",
  text,
  correlationId: "corr-1",
});

const blocksOf = (h: ReturnType<typeof createHarness>): readonly ReplyBlock[] =>
  h.conversations.replies.at(-1)?.blocks ?? [];

const textOf = (blocks: readonly ReplyBlock[]): string =>
  blocks
    .filter((b): b is Extract<ReplyBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join(" ");

/** Lleva la conversación hasta tener los datos mínimos para buscar. */
const completeProfile = async (h: ReturnType<typeof createHarness>): Promise<void> => {
  await run(() =>
    h.runTurn.execute(turn("busco apartamento en arriendo en Medellín hasta 3 millones")),
  );
};

describe("El agente con catálogo — de la conversación a los inmuebles", () => {
  it("busca en cuanto tiene los datos mínimos y presenta fichas reales", async () => {
    const h = createHarness();

    await completeProfile(h);

    const blocks = blocksOf(h);
    const list = blocks.find((b) => b.kind === "property_list");
    expect(list).toBeDefined();
    if (list?.kind !== "property_list") return;

    expect(list.items.length).toBeGreaterThan(0);
    for (const card of list.items) {
      // Cada ficha lleva datos, no prosa: eso es lo que impide inventar precios.
      expect(card.reference).toMatch(/^mock:/);
      expect(card.price).toMatch(/^\$[\d.]+/);
      expect(card.location).toContain("Medellín");
    }
  });

  it("el texto del modelo no contiene precios: los llevan las fichas", async () => {
    const h = createHarness();

    await completeProfile(h);

    const text = textOf(blocksOf(h));
    expect(text).toMatch(/encontré/i);
    // Si el modelo escribiera precios, el guardrail de grounding los habría
    // bloqueado; aquí se comprueba que directamente no lo intenta.
    expect(text).not.toMatch(/\$\s?[\d.]{4,}/);
  });

  it("respeta el presupuesto del cliente", async () => {
    const h = createHarness();

    await run(() =>
      h.runTurn.execute(turn("busco apartamento en arriendo en Medellín hasta 2 millones")),
    );

    const list = blocksOf(h).find((b) => b.kind === "property_list");
    if (list?.kind !== "property_list") throw new Error("debería haber resultados");

    for (const card of list.items) {
      const amount = Number(card.price?.replace(/\D/g, "") ?? "0");
      expect(amount).toBeLessThanOrEqual(2_000_000);
    }
  });

  it("deja constancia de lo que se le mostró al cliente", async () => {
    const h = createHarness();

    await completeProfile(h);

    // Snapshots guardados…
    expect(h.catalog.snapshots.stored.size).toBeGreaterThan(0);
    // …e impresiones ligadas a la conversación.
    expect(h.catalog.snapshots.impressions[0]?.conversationId).toBe("c1");
    // …y el evento que despertará a `leads` en F4.
    expect(h.events.ofType(PropertyShown)).toHaveLength(1);
  });

  it("mostrar dos veces lo mismo no duplica snapshots", async () => {
    const h = createHarness();

    await completeProfile(h);
    const afterFirst = h.catalog.snapshots.stored.size;

    await run(() => h.runTurn.execute(turn("muéstrame otra vez las opciones")));

    expect(h.catalog.snapshots.stored.size).toBe(afterFirst);
  });

  it("no busca sin saber si el cliente compra o arrienda", async () => {
    const h = createHarness();

    // "apartamento en Medellín" no dice la operación.
    await run(() => h.runTurn.execute(turn("me interesa un apartamento en Medellín")));

    const list = blocksOf(h).find((b) => b.kind === "property_list");
    expect(list).toBeUndefined();
    expect(textOf(blocksOf(h))).toMatch(/comprar o para arrendar/i);
  });

  it("cuando no hay nada que encaje, lo dice y propone ampliar", async () => {
    const h = createHarness();

    await run(() =>
      h.runTurn.execute(turn("busco casa en venta en Rionegro hasta 50 millones")),
    );

    const text = textOf(blocksOf(h));
    expect(text).toMatch(/no encontré/i);
    expect(blocksOf(h).find((b) => b.kind === "property_list")).toBeUndefined();
  });

  it("la traza del turno registra la búsqueda como herramienta", async () => {
    const h = createHarness();

    await completeProfile(h);

    const steps = h.runs.runs.at(-1)?.steps ?? [];
    const toolNames = steps.filter((s) => s.type === "TOOL_CALL").map((s) => s.name);
    expect(toolNames).toContain("search_properties");
  });

  it("una respuesta con resultados sigue pasando los guardrails", async () => {
    const h = createHarness();

    await completeProfile(h);

    const result = h.runs.runs.at(-1);
    expect(result?.status).toBe("COMPLETED");
    // Ningún guardrail bloqueó: el texto del modelo no cita datos sin respaldo.
    const guardrailSteps = (result?.steps ?? []).filter((s) => s.type === "GUARDRAIL");
    expect(guardrailSteps).toHaveLength(0);
  });
});
