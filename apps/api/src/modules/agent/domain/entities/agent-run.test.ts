import { describe, expect, it } from "vitest";
import { InvariantViolationError } from "../../../../platform/errors/app-error";
import { AgentStepType, truncate } from "../value-objects/agent-step";
import { TurnBudget } from "../value-objects/turn-budget";
import { AgentRun, AgentRunStatus } from "./agent-run";

const startedAt = new Date("2026-06-01T12:00:00.000Z");

const newRun = (): AgentRun =>
  AgentRun.start({
    id: "run-1",
    tenantId: "t1",
    conversationId: "c1",
    turnId: "turn-1",
    promptVersion: "v1",
    now: startedAt,
  });

describe("AgentRun", () => {
  it("numera los pasos en orden de ejecución", () => {
    const run = newRun();

    run.addStep({ type: AgentStepType.THOUGHT, payload: {}, durationMs: 10, at: startedAt });
    run.addStep({
      type: AgentStepType.TOOL_CALL,
      name: "save_customer_preferences",
      payload: { city: "Medellín" },
      durationMs: 5,
      at: startedAt,
    });

    expect(run.steps.map((s) => s.ordinal)).toEqual([0, 1]);
    expect(run.steps[1]?.name).toBe("save_customer_preferences");
  });

  it("acumula el consumo de varias llamadas al modelo", () => {
    const run = newRun();

    run.recordUsage({ promptTokens: 100, completionTokens: 20, estimatedCostUsd: 0.001 }, "mock-1");
    run.recordUsage({ promptTokens: 150, completionTokens: 30, estimatedCostUsd: 0.002 }, "mock-1");

    expect(run.usage.promptTokens).toBe(250);
    expect(run.usage.completionTokens).toBe(50);
    expect(run.usage.estimatedCostUsd).toBeCloseTo(0.003);
    expect(run.model).toBe("mock-1");
  });

  it("un run terminado no admite más pasos", () => {
    const run = newRun();
    run.complete(startedAt);

    expect(() => {
      run.addStep({ type: AgentStepType.MESSAGE, payload: {}, durationMs: 1, at: startedAt });
    }).toThrow(InvariantViolationError);
  });

  it("registra la latencia al terminar", () => {
    const run = newRun();

    run.complete(new Date("2026-06-01T12:00:02.500Z"));

    expect(run.status).toBe(AgentRunStatus.COMPLETED);
    expect(run.snapshot().latencyMs).toBe(2500);
  });

  it("escalar es un final legítimo, no un fallo", () => {
    const run = newRun();

    run.escalate("USER_REQUEST", startedAt);

    expect(run.status).toBe(AgentRunStatus.ESCALATED);
    expect(run.snapshot().escalationReason).toBe("USER_REQUEST");
    expect(run.snapshot().failureReason).toBeUndefined();
  });

  it("terminar dos veces no reescribe el desenlace", () => {
    const run = newRun();
    run.fail("timeout", startedAt);

    run.complete(new Date("2026-06-01T12:00:05.000Z"));

    expect(run.status).toBe(AgentRunStatus.FAILED);
  });

  it("trunca los payloads enormes en vez de guardarlos enteros", () => {
    const long = "x".repeat(5000);

    expect(String(truncate(long))).toHaveLength(2000 + "…[truncado]".length);
    expect(truncate({ items: Array.from({ length: 500 }, (_, i) => ({ i })) })).toMatchObject({
      truncated: true,
    });
  });
});

describe("TurnBudget", () => {
  const budget = (nowMs: () => number) =>
    new TurnBudget({ maxIterations: 3, maxToolCalls: 4, timeoutMs: 1000 }, 0, nowMs);

  it("deja seguir mientras quede margen", () => {
    const b = budget(() => 0);
    b.startIteration();

    expect(b.exhausted()).toBeNull();
  });

  it("corta al llegar al tope de iteraciones", () => {
    const b = budget(() => 0);
    b.startIteration();
    b.startIteration();
    b.startIteration();

    expect(b.exhausted()).toBe("iterations");
  });

  it("corta al llegar al tope de herramientas", () => {
    const b = budget(() => 0);
    b.registerToolCalls(4);

    expect(b.exhausted()).toBe("tool_calls");
    expect(b.remainingToolCalls).toBe(0);
  });

  it("corta por tiempo aunque queden iteraciones", () => {
    let now = 0;
    const b = budget(() => now);
    now = 1500;

    expect(b.exhausted()).toBe("timeout");
    expect(b.remainingMs).toBe(0);
  });
});
