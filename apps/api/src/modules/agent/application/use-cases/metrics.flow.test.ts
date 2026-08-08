import { describe, expect, it } from "vitest";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { createHarness, type Harness } from "../../testing/agent-turn.harness";

/**
 * MÉTRICAS DEL AGENTE, comprobadas sobre la exposición real.
 *
 * Las aserciones se hacen sobre el TEXTO que saldría por `/metrics`, no sobre
 * un doble que cuenta llamadas. Un doble demostraría que el código invoca al
 * contador; esto demuestra que lo que llega al recolector es lo que se esperaba.
 * La diferencia se paga el día que una etiqueta cambia de nombre y todas las
 * gráficas se quedan vacías sin que ningún test se entere.
 */

let turnCounter = 0;

const runTurn = (harness: Harness, text: string, contactId = "ct1") => {
  turnCounter += 1;
  harness.conversations.recordContact(text);

  return TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, () =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `turn-${String(turnCounter)}`,
      contactId,
      text,
      correlationId: "corr-1",
    }),
  );
};

describe("Métricas del turno del agente", () => {
  it("cuenta el turno por su desenlace", async () => {
    const harness = createHarness();

    await runTurn(harness, "busco apartamento en Medellín");

    expect(harness.metrics.render()).toContain('agentinmobi_agent_turns_total{status="COMPLETED"} 1');
  });

  it("distingue el escalamiento de la respuesta atendida", async () => {
    const harness = createHarness();

    await runTurn(harness, "quiero hablar con una persona");

    const salida = harness.metrics.render();
    expect(salida).toContain('agentinmobi_agent_turns_total{status="ESCALATED"} 1');
    expect(salida).not.toContain('status="COMPLETED"');
  });

  it("cuenta un turno que revienta, no lo pierde", async () => {
    const harness = createHarness();
    harness.conversations.failOnReply = true;

    await expect(runTurn(harness, "busco apartamento en Medellín")).rejects.toThrow();

    /*
     * Los turnos que fallan son justamente los que hay que ver en una gráfica.
     * Medir solo el camino feliz da un panel en verde durante una incidencia.
     */
    expect(harness.metrics.render()).toContain('agentinmobi_agent_turns_total{status="FAILED"} 1');
  });

  it("mide la llamada al modelo y sus tokens", async () => {
    const harness = createHarness();

    await runTurn(harness, "busco apartamento en Medellín");

    const salida = harness.metrics.render();
    expect(salida).toMatch(/agentinmobi_llm_requests_total\{provider="mock",[^}]*outcome="ok"\} \d+/);
    expect(salida).toMatch(/agentinmobi_agent_tokens_total\{kind="prompt"\} [1-9]/);
    expect(salida).toMatch(/agentinmobi_agent_tokens_total\{kind="completion"\} [1-9]/);
  });

  it("mide cada herramienta por su nombre y su desenlace", async () => {
    const harness = createHarness();

    await runTurn(harness, "busco apartamento en Medellín para arrendar");

    const llamadas = harness.metrics
      .render()
      .split("\n")
      .filter((line) => line.startsWith("agentinmobi_agent_tool_calls_total{"));

    expect(llamadas.length).toBeGreaterThan(0);
    expect(llamadas.every((line) => line.includes('tool="'))).toBe(true);
  });

  it("cuenta aparte los turnos que un límite paró antes del modelo", async () => {
    const harness = createHarness({ turnQuota: { burst: 1, perMinute: 60 } });

    await runTurn(harness, "hola");
    await runTurn(harness, "hola?");

    const salida = harness.metrics.render();
    expect(salida).toContain('agentinmobi_agent_turns_blocked_total{reason="rate_limit"} 1');
    /*
     * Separar "bloqueado" de "atendido" es lo que permite distinguir en una
     * gráfica un producto que no recibe tráfico de uno que lo está rechazando.
     */
    expect(salida).toContain('agentinmobi_agent_turns_total{status="SKIPPED"} 1');
  });

  it("ninguna métrica lleva identificadores en sus etiquetas", async () => {
    const harness = createHarness();

    await runTurn(harness, "busco apartamento en Medellín");

    const salida = harness.metrics.render();

    /*
     * La regla que evita que un panel se convierta en una factura (D64): cada
     * combinación de etiquetas es una serie que el sistema de monitorización
     * guarda para siempre. Con cientos de inmobiliarias, etiquetar por tenant
     * multiplica cada métrica por cientos.
     */
    expect(salida).not.toContain("t1");
    expect(salida).not.toContain("c1");
    expect(salida).not.toContain("corr-1");
  });
});
