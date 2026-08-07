import type { Database } from "../../../../../platform/database/prisma";
import { tenantScope } from "../../../../../platform/database/tenant-scope";
import type { LlmUsage } from "../../../application/ports/llm-provider";
import type { TenantSpend, UsageLedger } from "../../../application/ports/usage-ledger";

/**
 * Contador de consumo sobre PostgreSQL.
 *
 * La suma se hace **en la base**, no leyendo, sumando y escribiendo desde
 * Node. Con dos réplicas del worker cerrando turnos a la vez, un
 * leer-modificar-escribir pierde uno de los dos incrementos y el gasto
 * reportado queda por debajo del real — justo el error que hace inútil un tope.
 * `ON CONFLICT … DO UPDATE SET x = tabla.x + excluido.x` lo resuelve en una
 * sola sentencia atómica.
 */
export class PrismaUsageLedger implements UsageLedger {
  constructor(private readonly db: Database) {}

  async record(input: { period: string; usage: LlmUsage }): Promise<void> {
    const { tenantId } = tenantScope();
    const { promptTokens, completionTokens, estimatedCostUsd } = input.usage;

    await this.db.client().$executeRaw`
      INSERT INTO tenant_usage_periods
        (tenant_id, period, prompt_tokens, completion_tokens, spent_usd, turns, created_at, updated_at)
      VALUES
        (${tenantId}, ${input.period}, ${promptTokens}::bigint, ${completionTokens}::bigint,
         ${estimatedCostUsd}::numeric, 1, now(), now())
      ON CONFLICT (tenant_id, period) DO UPDATE SET
        prompt_tokens     = tenant_usage_periods.prompt_tokens     + EXCLUDED.prompt_tokens,
        completion_tokens = tenant_usage_periods.completion_tokens + EXCLUDED.completion_tokens,
        spent_usd         = tenant_usage_periods.spent_usd         + EXCLUDED.spent_usd,
        turns             = tenant_usage_periods.turns             + 1,
        updated_at        = now()
    `;
  }

  async spendIn(period: string): Promise<TenantSpend> {
    const row = await this.db.client().tenantUsagePeriod.findUnique({
      where: { tenantId_period: { ...tenantScope(), period } },
    });

    // Sin fila es que aún no ha gastado nada. No es un error ni un caso raro:
    // es el primer turno del mes de cada inmobiliaria.
    if (!row) {
      return { period, spentUsd: 0, promptTokens: 0, completionTokens: 0, turns: 0 };
    }

    return {
      period,
      spentUsd: Number(row.spentUsd),
      // `BigInt` no viaja a JSON ni sirve para aritmética con `number`; los
      // recuentos de tokens caben de sobra en un `number` seguro.
      promptTokens: Number(row.promptTokens),
      completionTokens: Number(row.completionTokens),
      turns: row.turns,
    };
  }
}
