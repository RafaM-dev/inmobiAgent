import { Lead, type LeadHistoryEntry } from "../domain/entities/lead";
import type {
  LeadListFilter,
  LeadRepository,
  LeadSummary,
} from "../domain/repositories/lead.repository";

const OPEN = new Set(["NEW", "CONTACTED", "QUALIFIED", "SCHEDULED"]);

/**
 * Doble de test del repositorio de leads.
 *
 * Guarda SNAPSHOTS y rehidrata en cada lectura, en vez de devolver la misma
 * instancia: así un test no puede pasar por accidente porque dos partes del
 * código compartían el mismo objeto en memoria. Es exactamente la diferencia
 * entre este doble y la base de datos real, y la única que importa.
 *
 * Las claves llevan el `tenantId` porque el bug de aislamiento que apareció en
 * F1 se coló justo por ahí: un doble que ignora el tenant hace pasar tests que
 * la producción suspende.
 */
export class InMemoryLeadRepository implements LeadRepository {
  private readonly rows = new Map<string, ReturnType<Lead["snapshot"]>>();
  readonly history: LeadHistoryEntry[] = [];

  findById(id: string): Promise<Lead | null> {
    const found = [...this.rows.values()].find((props) => props.id === id);
    return Promise.resolve(found ? Lead.rehydrate({ ...found }) : null);
  }

  findByConversation(conversationId: string): Promise<Lead | null> {
    const found = [...this.rows.values()].find(
      (props) => props.conversationId === conversationId,
    );
    return Promise.resolve(found ? Lead.rehydrate({ ...found }) : null);
  }

  save(lead: Lead): Promise<void> {
    const props = lead.snapshot();
    this.rows.set(`${props.tenantId}:${props.conversationId}`, props);
    this.history.push(...lead.pullHistory());
    return Promise.resolve();
  }

  list(filter: LeadListFilter): Promise<readonly LeadSummary[]> {
    const summaries = [...this.rows.values()]
      .filter((props) => (filter.status ? props.status === filter.status : true))
      .filter((props) => (filter.band ? props.score.band === filter.band : true))
      .filter((props) =>
        filter.assignedUserId ? props.assignedUserId === filter.assignedUserId : true,
      )
      .sort((a, b) => b.score.value - a.score.value)
      .slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit)
      .map(
        (props): LeadSummary => ({
          id: props.id,
          contactId: props.contactId,
          conversationId: props.conversationId,
          status: props.status,
          score: props.score.value,
          band: props.score.band,
          ...(props.assignedUserId !== undefined
            ? { assignedUserId: props.assignedUserId }
            : {}),
          interestCount: props.interests.length,
          lastActivityAt: props.lastActivityAt,
        }),
      );

    return Promise.resolve(summaries);
  }

  countOpenByAssignee(): Promise<Readonly<Record<string, number>>> {
    const counts: Record<string, number> = {};
    for (const props of this.rows.values()) {
      if (props.assignedUserId === undefined || !OPEN.has(props.status)) continue;
      counts[props.assignedUserId] = (counts[props.assignedUserId] ?? 0) + 1;
    }
    return Promise.resolve(counts);
  }
}
