import { describe, expect, it } from "vitest";
import type { AppError } from "../../../../platform/errors/app-error";
import { UpstreamError } from "../../../../platform/errors/app-error";
import { err, isOk, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ReplyBlock } from "../../../channels";
import { createHarness } from "../../testing/agent-turn.harness";
import type {
  LLMProvider,
  LlmGenerateResult,
} from "../ports/llm-provider";
import { AgentRunCompleted, HandoffRequested } from "../events/agent.events";

const run = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, fn);

const turn = (text: string) => ({
  conversationId: "c1",
  turnId: "turn-1",
  contactId: "ct1",
  text,
  correlationId: "corr-1",
});

const textOf = (blocks: readonly ReplyBlock[]): string =>
  blocks
    .filter((b): b is Extract<ReplyBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join(" ");

/** Proveedor de guion fijo, para forzar situaciones que el mock no produce. */
const scripted = (...responses: Partial<LlmGenerateResult>[]): LLMProvider => {
  let index = 0;
  return {
    id: "scripted",
    generate(): Promise<Result<LlmGenerateResult, AppError>> {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(
        ok({
          content: "",
          toolCalls: [],
          finishReason: "stop",
          model: "scripted-1",
          usage: { promptTokens: 10, completionTokens: 5, estimatedCostUsd: 0 },
          ...response,
        }),
      );
    },
  };
};

describe("RunAgentTurn — de punta a punta, sin base de datos", () => {
  it("saluda presentándose y preguntando lo que falta", async () => {
    const h = createHarness({ missing: ["operation", "city"] });

    const result = await run(() => h.runTurn.execute(turn("hola")));

    expect(isOk(result)).toBe(true);
    const reply = textOf(h.conversations.replies[0]?.blocks ?? []);
    expect(reply).toContain("Sofía");
    expect(reply).toContain("comprar o para arrendar");
  });

  it("extrae lo que el cliente dijo y lo guarda en la memoria", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("busco apto en arriendo en Medellín, 2 habitaciones")));

    expect(h.conversations.profile.city?.value).toBe("Medellín");
    expect(h.conversations.profile.operation?.value).toBe("RENT");
    expect(h.conversations.profile.bedrooms?.value).toBe(2);
  });

  it("lo que confirma la herramienta queda como dicho por el cliente, no deducido", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("busco casa en venta en Envigado")));

    // El extractor por reglas lo marcó `inferred`; la herramienta lo pisó con
    // `user`, que es la procedencia correcta (docs §11.1).
    expect(h.conversations.profile.city?.source).toBe("user");
    expect(h.conversations.profile.operation?.source).toBe("user");
  });

  it("ofrece botones cuando solo falta saber la operación", async () => {
    const h = createHarness();
    h.conversations.profile = {
      city: { value: "Medellín", source: "user", confidence: 1, updatedAt: new Date() },
      propertyType: { value: ["APARTMENT"], source: "user", confidence: 1, updatedAt: new Date() },
      budget: {
        value: { max: 45_000_000_000, currency: "COP" },
        source: "user",
        confidence: 1,
        updatedAt: new Date(),
      },
    };

    await run(() => h.runTurn.execute(turn("cuéntame")));

    const blocks = h.conversations.replies[0]?.blocks ?? [];
    expect(blocks.some((b) => b.kind === "quick_replies")).toBe(true);
  });

  it("escala sin gastar un token cuando el cliente pide una persona", async () => {
    let llmCalls = 0;
    const inner = scripted({ content: "hola" });
    const counting: LLMProvider = {
      id: "counting",
      generate: (request) => {
        llmCalls += 1;
        return inner.generate(request);
      },
    };
    const h = createHarness({ llm: counting });

    const result = await run(() => h.runTurn.execute(turn("quiero hablar con una persona")));

    expect(isOk(result) && result.value.status).toBe("ESCALATED");
    expect(llmCalls).toBe(0);
    expect(h.conversations.paused?.reason).toBe("USER_REQUEST");
    expect(h.events.ofType(HandoffRequested)).toHaveLength(1);
  });

  it("al escalar, silencia al bot antes de despedirse", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("necesito un abogado para la escritura")));

    expect(h.conversations.paused).toBeDefined();
    // El aviso lo firma la plataforma, no el agente: el bot ya está pausado.
    expect(h.conversations.replies[0]?.authorType).toBe("SYSTEM");
  });

  it("no dice que te pasa con el propio bot", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("quiero hablar con una persona")));

    const reply = textOf(h.conversations.replies[0]?.blocks ?? []);
    // "Te comunico con Sofía" siendo Sofía el bot es absurdo para el cliente.
    expect(reply).not.toContain("Sofía");
    expect(reply).toContain("asesor");
  });

  it("no envía un precio que ninguna herramienta devolvió", async () => {
    const h = createHarness({
      llm: scripted(
        { content: "Tengo un apartamento en Laureles por $450.000.000, ¿te interesa?" },
        { content: "Puedo consultarte precios con un asesor y te confirmo." },
      ),
    });

    await run(() => h.runTurn.execute(turn("qué opciones tienes")));

    const reply = textOf(h.conversations.replies[0]?.blocks ?? []);
    expect(reply).not.toContain("450.000.000");
    expect(reply).toContain("asesor");
  });

  it("si el modelo insiste en inventar, escala en vez de enviarlo", async () => {
    const h = createHarness({
      llm: scripted({ content: "Vale exactamente $999.999.999" }),
    });

    const result = await run(() => h.runTurn.execute(turn("cuánto cuesta")));

    expect(isOk(result) && result.value.status).toBe("ESCALATED");
    const reply = textOf(h.conversations.replies[0]?.blocks ?? []);
    expect(reply).not.toContain("999");
  });

  it("un proveedor caído no se le explica al cliente: se escala", async () => {
    const failing: LLMProvider = {
      id: "failing",
      generate: () =>
        Promise.resolve(err(new UpstreamError("openai", "timeout", "tardó demasiado"))),
    };
    const h = createHarness({ llm: failing });

    const result = await run(() => h.runTurn.execute(turn("hola")));

    expect(isOk(result) && result.value.status).toBe("ESCALATED");
    const reply = textOf(h.conversations.replies[0]?.blocks ?? []);
    expect(reply).not.toMatch(/timeout|openai|error/i);
  });

  it("respeta el presupuesto de iteraciones aunque el modelo insista", async () => {
    // Un modelo que pide herramientas indefinidamente.
    const looping = scripted({
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "c1", name: "save_customer_preferences", arguments: { city: "Medellín" } },
      ],
    });
    const h = createHarness({
      llm: looping,
      limits: { maxIterations: 3, maxToolCalls: 3, timeoutMs: 5000 },
    });

    const result = await run(() => h.runTurn.execute(turn("busco algo")));

    expect(isOk(result)).toBe(true);
    // Terminó: ni bucle infinito ni excepción.
    expect(h.runs.runs).toHaveLength(1);
    expect(h.runs.runs[0]?.isFinished).toBe(true);
  });

  it("no responde si un humano tomó la conversación mientras esperaba el turno", async () => {
    const h = createHarness();
    h.conversations.status = "HUMAN";

    const result = await run(() => h.runTurn.execute(turn("hola")));

    expect(isOk(result) && result.value.status).toBe("SKIPPED");
    expect(h.conversations.replies).toHaveLength(0);
  });

  it("deja la traza completa del turno y publica su coste", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("busco apartamento en Medellín")));

    const [agentRun] = h.runs.runs;
    expect(agentRun).toBeDefined();
    if (!agentRun) return;

    const types = agentRun.steps.map((step) => step.type);
    expect(types).toContain("TOOL_CALL");
    expect(types).toContain("TOOL_RESULT");
    expect(types).toContain("MESSAGE");

    const [completed] = h.events.ofType(AgentRunCompleted);
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.estimatedCostUsd).toBe(0);

    // La versión del prompt queda registrada: sin ella no se puede comparar el
    // comportamiento de dos versiones ni depurar "¿por qué respondió esto?".
    expect(agentRun.snapshot().promptVersion).toBe("v1");
  });

  it("un turno escalado sin llamar al modelo no reclama haber usado un prompt", async () => {
    const h = createHarness();

    await run(() => h.runTurn.execute(turn("quiero hablar con una persona")));

    expect(h.runs.runs[0]?.snapshot().promptVersion).toBe("none");
  });
});
