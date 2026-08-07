import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type {
  InboxEntry,
  InboxFilter,
  InboxQuery,
} from "../../domain/repositories/inbox.query";

export interface ListInboxCommand {
  readonly status?: InboxFilter["status"];
  readonly assignedUserId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListInboxResult {
  readonly items: readonly InboxEntry[];
  readonly total: number;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * Bandeja del asesor.
 *
 * El `tenantId` no aparece en el comando: lo pone el `TenantContext` que el
 * guardia de sesión fijó a partir de la cookie. No hay forma de pedir la
 * bandeja de otra inmobiliaria porque no hay dónde escribirlo.
 */
export class ListInboxUseCase {
  constructor(private readonly deps: { inbox: InboxQuery }) {}

  async execute(command: ListInboxCommand = {}): Promise<Result<ListInboxResult, AppError>> {
    const filter: InboxFilter = {
      ...(command.status ? { status: command.status } : {}),
      ...(command.assignedUserId ? { assignedUserId: command.assignedUserId } : {}),
      limit: Math.min(command.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      ...(command.offset !== undefined ? { offset: command.offset } : {}),
    };

    const [items, total] = await Promise.all([
      this.deps.inbox.list(filter),
      this.deps.inbox.count({
        ...(command.status ? { status: command.status } : {}),
        ...(command.assignedUserId ? { assignedUserId: command.assignedUserId } : {}),
      }),
    ]);

    return ok({ items, total });
  }
}
