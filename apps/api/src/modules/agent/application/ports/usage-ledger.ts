import type { LlmUsage } from "./llm-provider";

/**
 * PUERTO `UsageLedger` — cuánto lleva gastado cada inmobiliaria.
 *
 * Es un CONTADOR ACUMULADO, no una consulta agregada sobre `agent_runs`.
 *
 * La diferencia importa. Sumar el coste de todas las ejecuciones del mes en
 * cada turno funciona el primer mes y se degrada sin avisar: la tabla crece con
 * cada turno de cada inmobiliaria, y la comprobación que debía proteger la
 * factura acaba siendo lo más lento de la petición. Un contador es una lectura
 * puntual por índice, cueste lo que cueste el histórico.
 *
 * Y es EXACTO, no aproximado. Se pensó en cachear la suma unos segundos, pero
 * con varias réplicas del worker cada una tendría su propia idea del gasto y el
 * tope se superaría por tantas veces como réplicas haya. Un contador
 * transaccional no tiene ese problema y no es más código.
 */

export interface TenantSpend {
  readonly period: string;
  readonly spentUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly turns: number;
}

export interface UsageLedger {
  /**
   * Suma el consumo de un turno al periodo en curso.
   *
   * Se llama DESPUÉS de que el turno haya gastado, no antes: no se reserva
   * presupuesto. Un turno puede pasar el tope por su cuenta —lo que gaste él
   * mismo— y eso está bien: el tope acota el mes, no el turno. Para acotar el
   * turno ya está `TurnBudget`.
   */
  record(input: { period: string; usage: LlmUsage }): Promise<void>;

  /** Gasto del periodo. Cero si la inmobiliaria aún no ha gastado nada. */
  spendIn(period: string): Promise<TenantSpend>;
}
