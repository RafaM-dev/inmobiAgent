import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type {
  LeadListFilter,
  LeadRepository,
  LeadSummary,
} from "../../domain/repositories/lead.repository";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Bandeja de leads.
 *
 * Devuelve una proyección de lectura, no agregados: la bandeja del back-office
 * (F7) pinta cien filas y no necesita hidratar cien máquinas de estados. El
 * `tenantId` no aparece en el filtro por diseño — lo pone el repositorio desde
 * el `TenantContext`, así que no existe forma de pedir los leads de otra
 * inmobiliaria ni equivocándose.
 */
export class ListLeadsUseCase {
  constructor(private readonly deps: { leads: LeadRepository }) {}

  async execute(
    filter: Omit<LeadListFilter, "limit"> & { limit?: number } = {},
  ): Promise<Result<readonly LeadSummary[], AppError>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return ok(await this.deps.leads.list({ ...filter, limit }));
  }
}
