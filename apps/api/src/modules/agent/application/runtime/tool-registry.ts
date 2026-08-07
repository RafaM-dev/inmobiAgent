import { zodToJsonSchema } from "zod-to-json-schema";
import type { Clock } from "../../../../platform/clock/clock";
import type { Logger } from "../../../../platform/logging/logger";
import type { LlmToolCall, LlmToolSchema } from "../ports/llm-provider";
import {
  toolError,
  type AnyAgentTool,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

export interface ToolExecution {
  readonly callId: string;
  readonly name: string;
  readonly result: ToolResult<unknown>;
  readonly durationMs: number;
}

/**
 * Registro y ejecución de herramientas (docs §8.3).
 *
 * Concentra aquí, en un solo sitio, cuatro cosas que si se dejan a cada
 * herramienta acaban implementadas de cuatro maneras distintas:
 *
 *  1. **Validación estricta de argumentos.** Un modelo puede mandar cualquier
 *     cosa. Un argumento inválido NO es una excepción: se le devuelve el error
 *     al modelo para que se corrija solo, que es lo que hace un modelo bueno.
 *  2. **Timeout y cancelación.** Ninguna herramienta puede colgar un turno.
 *  3. **Aislamiento de fallos.** Una herramienta que revienta se convierte en
 *     un `ToolResult` de error, nunca tumba el turno entero.
 *  4. **Auditoría.** Cada ejecución queda con sus argumentos, su resultado y
 *     su duración.
 *
 * Y una que NO hace y es igual de importante: nunca acepta `tenantId` como
 * argumento. Viene del `ToolContext` (docs §8.1).
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();
  private readonly schemas = new Map<string, LlmToolSchema>();

  constructor(
    private readonly deps: {
      logger: Logger;
      clock: Clock;
      /** Tiempo máximo por herramienta. */
      timeoutMs?: number;
    },
  ) {}

  register<TArgs, TResult>(tool: AgentTool<TArgs, TResult>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Herramienta duplicada: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as AnyAgentTool);

    // El esquema que ve el modelo se DERIVA del Zod que valida la ejecución.
    // Escribirlos por separado garantiza que un día dejen de coincidir.
    const parameters = zodToJsonSchema(tool.parameters, {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;

    this.schemas.set(tool.name, {
      name: tool.name,
      description: tool.description,
      parameters,
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): readonly string[] {
    return [...this.tools.keys()];
  }

  /** Esquemas para el proveedor. `enabled` permite limitarlos por tenant (F7). */
  schemasFor(enabled?: readonly string[]): LlmToolSchema[] {
    const names = enabled ?? [...this.schemas.keys()];
    return names
      .map((name) => this.schemas.get(name))
      .filter((schema): schema is LlmToolSchema => schema !== undefined);
  }

  async execute(call: LlmToolCall, context: ToolContext): Promise<ToolExecution> {
    const startedAt = this.deps.clock.nowMs();
    const finish = (result: ToolResult<unknown>): ToolExecution => ({
      callId: call.id,
      name: call.name,
      result,
      durationMs: this.deps.clock.nowMs() - startedAt,
    });

    const tool = this.tools.get(call.name);
    if (!tool) {
      // Ocurre: los modelos inventan nombres de herramientas. Se le dice y sigue.
      return finish(
        toolError("TOOL_NOT_FOUND", `No existe una herramienta llamada "${call.name}"`, false),
      );
    }

    const parsed = tool.parameters.safeParse(call.arguments);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
        .join("; ");
      return finish(
        toolError("TOOL_INVALID_ARGUMENTS", `Argumentos inválidos. ${detail}`, true),
      );
    }

    try {
      const result = await this.withTimeout(
        tool.execute(parsed.data, context),
        context,
        call.name,
      );
      return finish(result);
    } catch (error) {
      this.deps.logger.error("Herramienta lanzó una excepción", {
        tool: call.name,
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      return finish(
        toolError("TOOL_EXECUTION_FAILED", "La herramienta no pudo completarse", false),
      );
    }
  }

  private async withTimeout(
    promise: Promise<ToolResult<unknown>>,
    context: ToolContext,
    name: string,
  ): Promise<ToolResult<unknown>> {
    const timeoutMs = this.deps.timeoutMs ?? 10_000;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ToolResult<unknown>>((resolve) => {
      timer = setTimeout(() => {
        this.deps.logger.warn("Herramienta agotó su tiempo", { tool: name, timeoutMs });
        resolve(toolError("UPSTREAM_TIMEOUT", "La consulta tardó demasiado", true));
      }, timeoutMs);
      // Si el turno entero se cancela, no tiene sentido seguir esperando.
      context.abortSignal.addEventListener(
        "abort",
        () => {
          resolve(toolError("ABORTED", "El turno se canceló antes de terminar", false));
        },
        { once: true },
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
