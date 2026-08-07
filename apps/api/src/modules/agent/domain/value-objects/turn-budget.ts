export interface TurnBudgetLimits {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly timeoutMs: number;
}

export type BudgetStop = "iterations" | "tool_calls" | "timeout";

/**
 * Presupuesto de un turno (docs §8.3).
 *
 * Un bucle de tool calling sin límites es una factura sin límites y una espera
 * sin límites para el cliente. Estos tres topes son lo único que separa "el
 * agente insiste un poco" de "el agente lleva 400 llamadas y 90 segundos".
 *
 * Es un objeto de dominio y no un `if` suelto en el orquestador porque agotar
 * el presupuesto tiene consecuencias de negocio: se responde con lo que haya y
 * se escala a un humano, en vez de dejar al cliente sin respuesta.
 */
export class TurnBudget {
  private iterations = 0;
  private toolCalls = 0;

  constructor(
    private readonly limits: TurnBudgetLimits,
    private readonly startedAtMs: number,
    private readonly nowMs: () => number,
  ) {}

  startIteration(): void {
    this.iterations += 1;
  }

  registerToolCalls(count: number): void {
    this.toolCalls += count;
  }

  get elapsedMs(): number {
    return this.nowMs() - this.startedAtMs;
  }

  get remainingMs(): number {
    return Math.max(0, this.limits.timeoutMs - this.elapsedMs);
  }

  get usedIterations(): number {
    return this.iterations;
  }

  get usedToolCalls(): number {
    return this.toolCalls;
  }

  /** Cuántas herramientas más se pueden llamar sin pasarse del tope. */
  get remainingToolCalls(): number {
    return Math.max(0, this.limits.maxToolCalls - this.toolCalls);
  }

  /** `null` si se puede seguir; el motivo del corte si no. */
  exhausted(): BudgetStop | null {
    if (this.iterations >= this.limits.maxIterations) return "iterations";
    if (this.toolCalls >= this.limits.maxToolCalls) return "tool_calls";
    if (this.elapsedMs >= this.limits.timeoutMs) return "timeout";
    return null;
  }
}
