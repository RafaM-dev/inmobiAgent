import type { Clock } from "../../../../platform/clock/clock";
import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantDirectory } from "../../../identity";
import { billingPeriodOf } from "../../domain/policies/spend-limit.policy";
import type { UsageLedger } from "../ports/usage-ledger";

export interface UsageSummaryView {
  readonly period: string;
  readonly spentUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly turns: number;
  readonly limitUsd: number;
  readonly ratio: number;
}

/**
 * Cuánto lleva gastada la inmobiliaria este mes, y cuánto le queda.
 *
 * Devuelve el TOPE VIGENTE, no el configurado: el de la inmobiliaria si lo
 * tiene y el del despliegue si no. Mostrar el campo vacío cuando el tope
 * efectivo viene de la configuración global haría creer que no hay ninguno.
 */
export class GetUsageSummaryUseCase {
  constructor(
    private readonly deps: {
      usage: UsageLedger;
      tenants: TenantDirectory;
      clock: Clock;
      defaultMonthlyBudgetUsd?: number;
    },
  ) {}

  async execute(): Promise<Result<UsageSummaryView, AppError>> {
    const tenant = await this.deps.tenants.requireActive(TenantContext.requireTenantId());

    const period = billingPeriodOf(this.deps.clock.now(), tenant.timezone);
    const spend = await this.deps.usage.spendIn(period);

    const limitUsd = tenant.settings.monthlyBudgetUsd ?? this.deps.defaultMonthlyBudgetUsd ?? 0;

    return ok({
      period,
      spentUsd: spend.spentUsd,
      promptTokens: spend.promptTokens,
      completionTokens: spend.completionTokens,
      turns: spend.turns,
      limitUsd,
      // Sin tope no hay fracción que mostrar: una barra al 0 % es más honesta
      // que una al infinito.
      ratio: limitUsd > 0 ? spend.spentUsd / limitUsd : 0,
    });
  }
}
