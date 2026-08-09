import { blocksToText, type ReplyBlock } from "../src/modules/channels";
import { createHarness, type Harness } from "../src/modules/agent/testing/agent-turn.harness";
import type { LLMProvider } from "../src/modules/agent/application/ports/llm-provider";
import { isErr } from "../src/platform/result/result";
import { TenantContext } from "../src/platform/tenancy/tenant-context";
import type { EvalContext, EvalScenario, Expectation, Severity } from "./scenario";

/**
 * Ejecuta los escenarios contra el agente REAL.
 *
 * No hay atajos: cada turno pasa por `RunAgentTurnUseCase` —el mismo caso de
 * uso que atiende a un cliente por WhatsApp—, con sus herramientas de verdad,
 * su presupuesto, sus guardrails y su composición de bloques. Lo único que
 * cambia entre una ejecución con el simulador y una con Anthropic es qué hay
 * detrás del puerto `LLMProvider`.
 *
 * Cada escenario arranca con un arné NUEVO: sin memoria previa, sin CRM
 * heredado y sin cubos de ritmo a medio gastar. Reutilizarlo haría que el orden
 * de los escenarios cambiara el resultado, que es la forma más rápida de tener
 * una suite en la que nadie confía.
 */

export interface ExpectationResult {
  readonly name: string;
  readonly severity: Severity;
  readonly failure: string | null;
  /** En qué turno se comprobó. `-1` para las de estado final. */
  readonly turn: number;
}

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly results: readonly ExpectationResult[];
  readonly passed: boolean;
  readonly criticalFailures: number;
  readonly durationMs: number;
  readonly costUsd: number;
  /** Transcripción, para poder leer QUÉ contestó cuando algo falla. */
  readonly transcript: readonly { user: string; agent: string }[];
  /** Lo que impidió terminar el escenario, si reventó. */
  readonly crashed?: string;
}

export interface EvalRun {
  readonly provider: string;
  readonly scenarios: readonly ScenarioResult[];
  /** Expectativas de calidad superadas sobre el total. `0..1`. */
  readonly score: number;
  readonly criticalFailures: number;
  readonly durationMs: number;
  readonly totalCostUsd: number;
}

const TENANT = { tenantId: "t1", correlationId: "eval", source: "cli" as const };

/**
 * Prepara el mundo antes del primer turno.
 *
 * El conocimiento se siembra aquí y no en cada escenario porque es el
 * equivalente al reglamento que una inmobiliaria sube el primer día: forma
 * parte del entorno, no de lo que se está midiendo.
 */
export const REGLAMENTO = `## Mascotas
Se permiten mascotas de hasta quince kilos en las unidades residenciales, previa
autorización escrita de la administración.

## Requisitos de arrendamiento
El requisito principal es demostrar ingresos equivalentes a tres veces el canon
mensual, mediante certificación laboral vigente.

## Comisión de administración
La comisión de administración corresponde al diez por ciento del canon.`;

const seedKnowledge = async (harness: Harness): Promise<void> => {
  const added = await TenantContext.run(TENANT, () =>
    harness.knowledge.addDocument({
      collection: "Políticas",
      title: "Reglamento de propiedad horizontal",
      text: REGLAMENTO,
    }),
  );
  if (isErr(added)) throw added.error;
};

const runScenario = async (
  definition: EvalScenario,
  provider: LLMProvider | undefined,
): Promise<ScenarioResult> => {
  const startedAt = performance.now();
  const harness = createHarness({
    ...(provider ? { llm: provider } : {}),
    // Sin límite de ritmo: un escenario largo no es un abuso, y que la suite
    // fallara por su propia longitud no diría nada del agente.
    turnQuota: { burst: 0, perMinute: 0 },
  });

  const results: ExpectationResult[] = [];
  const transcript: { user: string; agent: string }[] = [];
  let context: EvalContext | undefined;
  let costUsd = 0;

  const record = (expectations: readonly Expectation[], turn: number): void => {
    if (!context) return;
    for (const expectation of expectations) {
      results.push({
        name: expectation.name,
        severity: expectation.severity,
        failure: expectation.check(context),
        turn,
      });
    }
  };

  try {
    await seedKnowledge(harness);

    for (const [index, turn] of definition.turns.entries()) {
      context = await say(harness, definition.id, index, turn.user);
      costUsd += context.costUsd;
      transcript.push({ user: turn.user, agent: context.reply });
      record(turn.expect, index);
    }

    record(definition.then ?? [], -1);
  } catch (error) {
    // Un escenario que revienta cuenta como fallo crítico, no se salta. Que el
    // agente lance una excepción ante un mensaje concreto ES el defecto.
    return {
      id: definition.id,
      title: definition.title,
      tags: definition.tags,
      results,
      passed: false,
      criticalFailures: 1,
      durationMs: Math.round(performance.now() - startedAt),
      costUsd,
      transcript,
      crashed: error instanceof Error ? error.message : String(error),
    };
  }

  const criticalFailures = results.filter(
    (result) => result.severity === "critical" && result.failure !== null,
  ).length;

  return {
    id: definition.id,
    title: definition.title,
    tags: definition.tags,
    results,
    passed: results.every((result) => result.failure === null),
    criticalFailures,
    durationMs: Math.round(performance.now() - startedAt),
    costUsd,
    transcript,
  };
};

/** Un turno del cliente, exactamente como llegaría del canal. */
const say = async (
  harness: Harness,
  scenarioId: string,
  index: number,
  text: string,
): Promise<EvalContext> => {
  harness.conversations.recordContact(text);
  const before = harness.conversations.replies.length;
  const runsBefore = harness.runs.runs.length;
  const startedAt = performance.now();

  const outcome = await TenantContext.run(TENANT, () =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `${scenarioId}-${String(index)}`,
      contactId: "ct1",
      text,
      correlationId: "eval",
    }),
  );

  const latencyMs = Math.round(performance.now() - startedAt);
  if (isErr(outcome)) throw outcome.error;

  const nuevos = harness.conversations.replies.slice(before);
  const blocks: ReplyBlock[] = nuevos.flatMap((reply) => [...reply.blocks]);

  /*
   * Se separa lo que REDACTÓ el modelo de lo que renderizaron las herramientas.
   *
   * `compose()` pone SIEMPRE el texto del modelo primero y detrás los bloques
   * que produjeron las herramientas con sus datos. Todo lo que viene después
   * —la ficha de un inmueble, la confirmación de una cita con su fecha— sale
   * del catálogo o de la agenda y es cierto por construcción.
   *
   * La distinción no es un detalle: sin ella, «tu visita quedó agendada:
   * miércoles a la 1:00 p. m.» —una frase que escribe la herramienta con la
   * fecha real— se leería como que el modelo se inventó una hora. Un falso
   * positivo en la comprobación más crítica de la suite, y el camino más corto
   * a que alguien la desactive.
   */
  const spoken =
    blocks.find(
      (block): block is Extract<ReplyBlock, { kind: "text" }> => block.kind === "text",
    )?.text ?? "";

  const run = harness.runs.runs.at(-1);
  const nuevoRun = harness.runs.runs.length > runsBefore ? run : undefined;
  const steps = nuevoRun?.snapshot().steps ?? [];

  return {
    reply: blocksToText(blocks),
    spoken,
    blocks,
    toolsUsed: steps
      .filter((step) => step.type === "TOOL_CALL")
      .map((step) => step.name ?? "")
      .filter((name) => name.length > 0),
    toolOutput: steps
      .filter((step) => step.type === "TOOL_RESULT")
      .map((step) => JSON.stringify(step.payload))
      .join(" "),
    status: outcome.value.status,
    latencyMs,
    costUsd: nuevoRun?.usage.estimatedCostUsd ?? 0,
    harness,
  };
};

export const runEvaluation = async (input: {
  scenarios: readonly EvalScenario[];
  /** `undefined` = el simulador determinista del arnés. */
  provider?: LLMProvider;
  onProgress?: (result: ScenarioResult) => void;
}): Promise<EvalRun> => {
  const startedAt = performance.now();
  const scenarios: ScenarioResult[] = [];

  for (const definition of input.scenarios) {
    const result = await runScenario(definition, input.provider);
    scenarios.push(result);
    input.onProgress?.(result);
  }

  const quality = scenarios.flatMap((scenario) =>
    scenario.results.filter((result) => result.severity === "quality"),
  );
  const superadas = quality.filter((result) => result.failure === null).length;

  return {
    provider: input.provider?.id ?? "mock",
    scenarios,
    // Sin expectativas de calidad la puntuación es 1: no hay nada que suspender.
    score: quality.length === 0 ? 1 : superadas / quality.length,
    criticalFailures: scenarios.reduce((total, s) => total + s.criticalFailures, 0),
    durationMs: Math.round(performance.now() - startedAt),
    // Con el simulador es cero, y esa es la gracia del modo demo. Con un
    // proveedor real, es lo que cuesta saber si el agente sigue respondiendo
    // bien: un número que conviene mirar antes de meter la suite en CI.
    totalCostUsd: scenarios.reduce((total, s) => total + s.costUsd, 0),
  };
};
