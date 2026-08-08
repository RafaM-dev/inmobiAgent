import type { AppError } from "../../../../platform/errors/app-error";
import type { Clock } from "../../../../platform/clock/clock";
import type { Result } from "../../../../platform/result/result";
import { isErr } from "../../../../platform/result/result";
import type { AppMetrics } from "../../../../platform/telemetry/app-metrics";
import type {
  LLMProvider,
  LlmGenerateRequest,
  LlmGenerateResult,
} from "../../application/ports/llm-provider";

/**
 * Decorador que mide cualquier proveedor de IA.
 *
 * **Un decorador y no código dentro de cada adaptador.** Son tres adaptadores
 * hoy y serán cinco mañana; medir en cada uno significa escribir lo mismo cinco
 * veces y descubrir dentro de un año que el quinto se olvidó del contador de
 * errores. Aquí se envuelve una vez, en el composition root, y el que venga
 * después está medido antes de escribirse.
 *
 * **Y no dentro del caso de uso**, que era la otra opción: el turno llama al
 * modelo desde dos sitios —el bucle de herramientas y el reintento tras un
 * guardrail—, así que serían dos sitios que mantener sincronizados.
 *
 * No etiqueta por inmobiliaria (D64). El coste por inmobiliaria ya está donde
 * tiene que estar: en `tenant_usage_periods`, exacto y transaccional.
 */
export class MeteredLLMProvider implements LLMProvider {
  readonly id: string;

  constructor(
    private readonly deps: {
      inner: LLMProvider;
      metrics: AppMetrics;
      clock: Clock;
    },
  ) {
    // El identificador es el del proveedor real: el decorador es invisible.
    this.id = deps.inner.id;
  }

  async generate(request: LlmGenerateRequest): Promise<Result<LlmGenerateResult, AppError>> {
    const startedAt = this.deps.clock.nowMs();
    const provider = this.id;
    /*
     * Modelo pedido, no el que respondió: cuando la llamada falla no hay
     * respuesta de la que sacarlo, y una etiqueta que cambia según el desenlace
     * partiría la misma serie en dos. El modelo que respondió de verdad se
     * persiste en el `AgentRun`.
     */
    const model = request.model ?? "(por defecto)";

    let result: Result<LlmGenerateResult, AppError>;
    try {
      result = await this.deps.inner.generate(request);
    } catch (error) {
      // El puerto promete devolver `Result` y no lanzar. Si un adaptador
      // incumple, el fallo se cuenta igual: una métrica que solo mide el camino
      // previsto es la que falta justo cuando algo se sale de él.
      this.record(provider, model, "exception", startedAt);
      throw error;
    }

    this.record(provider, model, isErr(result) ? errorOutcome(result.error) : "ok", startedAt);

    if (!isErr(result)) {
      const { usage } = result.value;
      this.deps.metrics.agentTurnTokens.inc({ kind: "prompt" }, usage.promptTokens);
      this.deps.metrics.agentTurnTokens.inc({ kind: "completion" }, usage.completionTokens);
      this.deps.metrics.agentTurnCostUsd.inc({ provider }, usage.estimatedCostUsd);
    }

    return result;
  }

  private record(provider: string, model: string, outcome: string, startedAt: number): void {
    this.deps.metrics.llmRequests.inc({ provider, model, outcome });
    this.deps.metrics.llmDuration.observe((this.deps.clock.nowMs() - startedAt) / 1000, {
      provider,
      model,
    });
  }
}

/**
 * Desenlace de un fallo: el CÓDIGO de error, no su mensaje.
 *
 * El mensaje puede llevar el texto que devolvió el proveedor —variable,
 * ilimitado y a veces con datos dentro—, y eso como etiqueta es una serie nueva
 * por cada fallo distinto. Los códigos son un conjunto cerrado.
 */
const errorOutcome = (error: AppError): string => error.code;
