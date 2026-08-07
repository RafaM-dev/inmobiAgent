import {
  ACTIVE_STATUSES,
  Appointment,
  type AppointmentHistoryEntry,
} from "../domain/entities/appointment";
import type { AppointmentRepository } from "../domain/repositories/appointment.repository";

/**
 * Doble de test de la agenda.
 *
 * Igual que el de leads: guarda snapshots y rehidrata, para que ningún test
 * pase por accidente al compartir la misma instancia en memoria.
 */
export class InMemoryAppointmentRepository implements AppointmentRepository {
  private readonly rows = new Map<string, ReturnType<Appointment["snapshot"]>>();
  readonly history: AppointmentHistoryEntry[] = [];

  findById(id: string): Promise<Appointment | null> {
    const found = this.rows.get(id);
    return Promise.resolve(found ? Appointment.rehydrate({ ...found }) : null);
  }

  findActiveByConversation(conversationId: string): Promise<Appointment | null> {
    const found = [...this.rows.values()]
      .filter((props) => props.conversationId === conversationId)
      .filter((props) => ACTIVE_STATUSES.includes(props.status))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

    return Promise.resolve(found ? Appointment.rehydrate({ ...found }) : null);
  }

  save(appointment: Appointment): Promise<void> {
    const props = appointment.snapshot();
    this.rows.set(props.id, props);
    this.history.push(...appointment.pullHistory());
    return Promise.resolve();
  }

  listActiveBetween(from: Date, to: Date, assignedUserId?: string): Promise<Appointment[]> {
    const found = [...this.rows.values()]
      .filter((props) => ACTIVE_STATUSES.includes(props.status))
      .filter(
        (props) =>
          props.scheduledAt.getTime() >= from.getTime() &&
          props.scheduledAt.getTime() < to.getTime(),
      )
      .filter((props) =>
        assignedUserId === undefined ? true : props.assignedUserId === assignedUserId,
      )
      .map((props) => Appointment.rehydrate({ ...props }));

    return Promise.resolve(found);
  }

  listPendingReminders(before: Date, now: Date, limit: number): Promise<Appointment[]> {
    const found = [...this.rows.values()]
      .filter((props) => ACTIVE_STATUSES.includes(props.status))
      .filter((props) => props.reminderSentAt === undefined)
      .filter(
        (props) =>
          props.scheduledAt.getTime() > now.getTime() &&
          props.scheduledAt.getTime() <= before.getTime(),
      )
      .slice(0, limit)
      .map((props) => Appointment.rehydrate({ ...props }));

    return Promise.resolve(found);
  }

  listTenantsWithPendingReminders(before: Date, now: Date): Promise<string[]> {
    const tenants = new Set<string>();
    for (const props of this.rows.values()) {
      if (!ACTIVE_STATUSES.includes(props.status)) continue;
      if (props.reminderSentAt !== undefined) continue;
      if (props.scheduledAt.getTime() <= now.getTime()) continue;
      if (props.scheduledAt.getTime() > before.getTime()) continue;
      tenants.add(props.tenantId);
    }
    return Promise.resolve([...tenants]);
  }
}
