import type { LlmUsage } from "../application/ports/llm-provider";
import type { TenantSpend, UsageLedger } from "../application/ports/usage-ledger";

/**
 * Contador de consumo en memoria.
 *
 * Suma igual que el real: el `record` acumula sobre el periodo en vez de
 * sustituir. Un doble que se limitara a guardar el último turno haría pasar
 * tests que en producción fallarían al segundo mensaje.
 */
export class InMemoryUsageLedger implements UsageLedger {
  private readonly periods = new Map<string, TenantSpend>();

  /** Fija el gasto de un periodo. Para montar el escenario "ya en el tope". */
  seed(period: string, spentUsd: number): void {
    this.periods.set(period, {
      period,
      spentUsd,
      promptTokens: 0,
      completionTokens: 0,
      turns: 0,
    });
  }

  record(input: { period: string; usage: LlmUsage }): Promise<void> {
    const current = this.periods.get(input.period);

    this.periods.set(input.period, {
      period: input.period,
      spentUsd: (current?.spentUsd ?? 0) + input.usage.estimatedCostUsd,
      promptTokens: (current?.promptTokens ?? 0) + input.usage.promptTokens,
      completionTokens: (current?.completionTokens ?? 0) + input.usage.completionTokens,
      turns: (current?.turns ?? 0) + 1,
    });

    return Promise.resolve();
  }

  spendIn(period: string): Promise<TenantSpend> {
    return Promise.resolve(
      this.periods.get(period) ?? {
        period,
        spentUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        turns: 0,
      },
    );
  }
}
