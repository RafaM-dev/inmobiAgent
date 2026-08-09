import type { Appointment as PrismaAppointment } from "@prisma/client";
import { toJson } from "../../../../../platform/database/json";
import type { Database } from "../../../../../platform/database/prisma";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import { ACTIVE_STATUSES, Appointment } from "../../../domain/entities/appointment";
import type { AppointmentRepository } from "../../../domain/repositories/appointment.repository";

const toDomain = (row: PrismaAppointment): Appointment =>
  Appointment.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    ...(row.leadId !== null ? { leadId: row.leadId } : {}),
    ...(row.propertyRef !== null ? { propertyRef: row.propertyRef } : {}),
    status: row.status,
    scheduledAt: row.scheduledAt,
    durationMin: row.durationMin,
    ...(row.assignedUserId !== null ? { assignedUserId: row.assignedUserId } : {}),
    ...(row.location !== null ? { location: row.location } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    requestedAt: row.requestedAt,
    ...(row.confirmedAt !== null ? { confirmedAt: row.confirmedAt } : {}),
    ...(row.cancelledAt !== null ? { cancelledAt: row.cancelledAt } : {}),
    ...(row.cancellationReason !== null
      ? { cancellationReason: row.cancellationReason }
      : {}),
    ...(row.reminderSentAt !== null ? { reminderSentAt: row.reminderSentAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaAppointmentRepository implements AppointmentRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async findById(id: string): Promise<Appointment | null> {
    const row = await this.db.client().appointment.findFirst({
      where: { ...tenantScope(), id },
    });
    return row ? toDomain(row) : null;
  }

  async findActiveByConversation(conversationId: string): Promise<Appointment | null> {
    const row = await this.db.client().appointment.findFirst({
      where: {
        ...tenantScope(),
        conversationId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { scheduledAt: "asc" },
    });
    return row ? toDomain(row) : null;
  }

  async save(appointment: Appointment): Promise<void> {
    const data = appointment.snapshot();
    assertWritableTenant(data.tenantId, "cita");

    const client = this.db.client();

    const persistable = {
      leadId: data.leadId ?? null,
      propertyRef: data.propertyRef ?? null,
      status: data.status,
      scheduledAt: data.scheduledAt,
      durationMin: data.durationMin,
      assignedUserId: data.assignedUserId ?? null,
      location: data.location ?? null,
      notes: data.notes ?? null,
      confirmedAt: data.confirmedAt ?? null,
      cancelledAt: data.cancelledAt ?? null,
      cancellationReason: data.cancellationReason ?? null,
      reminderSentAt: data.reminderSentAt ?? null,
      updatedAt: data.updatedAt,
    };

    await client.appointment.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        contactId: data.contactId,
        conversationId: data.conversationId,
        requestedAt: data.requestedAt,
        createdAt: data.createdAt,
        ...persistable,
      },
      update: persistable,
    });

    const history = appointment.pullHistory();
    if (history.length > 0) {
      await client.appointmentEvent.createMany({
        data: history.map((entry) => ({
          id: this.ids.generate(),
          tenantId: data.tenantId,
          appointmentId: data.id,
          type: entry.type,
          payload: toJson(entry.payload),
          occurredAt: entry.at,
        })),
      });
    }
  }

  async listActiveBetween(
    from: Date,
    to: Date,
    assignedUserId?: string,
  ): Promise<Appointment[]> {
    const rows = await this.db.client().appointment.findMany({
      where: {
        ...tenantScope(),
        status: { in: [...ACTIVE_STATUSES] },
        scheduledAt: { gte: from, lt: to },
        ...(assignedUserId !== undefined ? { assignedUserId } : {}),
      },
      orderBy: { scheduledAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async listPendingReminders(before: Date, now: Date, limit: number): Promise<Appointment[]> {
    const rows = await this.db.client().appointment.findMany({
      where: {
        ...tenantScope(),
        status: { in: [...ACTIVE_STATUSES] },
        reminderSentAt: null,
        scheduledAt: { gt: now, lte: before },
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    });
    return rows.map(toDomain);
  }

  /**
   * ÚNICA consulta del módulo sin ámbito de tenant, y por eso solo devuelve
   * identificadores: el job necesita saber a quién visitar antes de poder
   * entrar en el contexto de nadie. Ni un dato de negocio sale de aquí.
   */
  async listTenantsWithPendingReminders(before: Date, now: Date): Promise<string[]> {
    const rows = await this.db.client().appointment.groupBy({
      by: ["tenantId"],
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        reminderSentAt: null,
        scheduledAt: { gt: now, lte: before },
      },
    });
    return rows.map((row) => row.tenantId);
  }
}
