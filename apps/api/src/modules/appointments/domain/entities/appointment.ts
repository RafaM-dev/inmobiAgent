import { DomainError } from "../../../../platform/errors/app-error";
import type { TimeSlot } from "../value-objects/time-slot";

export const AppointmentStatus = {
  REQUESTED: "REQUESTED",
  CONFIRMED: "CONFIRMED",
  RESCHEDULED: "RESCHEDULED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  NO_SHOW: "NO_SHOW",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

/**
 * Transiciones legales. `RESCHEDULED` no es un estado terminal sino uno vivo:
 * una cita reprogramada sigue siendo una cita, y desde ahí se confirma o se
 * cancela como cualquier otra.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  REQUESTED: ["CONFIRMED", "RESCHEDULED", "CANCELLED"],
  CONFIRMED: ["RESCHEDULED", "CANCELLED", "COMPLETED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "RESCHEDULED", "CANCELLED", "COMPLETED", "NO_SHOW"],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

/** Estados en los que la cita todavía ocupa un hueco en la agenda. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "RESCHEDULED",
];

export interface AppointmentHistoryEntry {
  readonly type: string;
  readonly at: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AppointmentProps {
  readonly id: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly leadId?: string;
  /** Inmueble a visitar, en formato `"source:externalId"`. Puede no haberlo:
   *  también se agendan visitas a la oficina para orientar al cliente. */
  readonly propertyRef?: string;
  readonly status: AppointmentStatus;
  readonly scheduledAt: Date;
  readonly durationMin: number;
  readonly assignedUserId?: string;
  readonly location?: string;
  readonly notes?: string;
  readonly requestedAt: Date;
  readonly confirmedAt?: Date;
  readonly cancelledAt?: Date;
  readonly cancellationReason?: string;
  /** Evita mandar el mismo recordatorio dos veces. */
  readonly reminderSentAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * AGREGADO `Appointment` — una visita acordada.
 *
 * Es el objetivo del producto: la conversación existe para llegar aquí. Por eso
 * la cita NO vive dentro del lead: sobrevive al lead, se reprograma, se cancela
 * y se cumple con su propio ciclo de vida, y un asesor la ve en su agenda
 * aunque el lead ya se haya ganado.
 *
 * Igual que `Lead`, acumula historial y lo entrega al repositorio: un cambio de
 * hora sin rastro de quién y cuándo es una discusión con el cliente que no se
 * puede ganar.
 */
export class Appointment {
  private history: AppointmentHistoryEntry[] = [];

  private constructor(private props: AppointmentProps) {}

  static request(input: {
    id: string;
    tenantId: string;
    contactId: string;
    conversationId: string;
    leadId?: string;
    propertyRef?: string;
    slot: TimeSlot;
    assignedUserId?: string;
    location?: string;
    notes?: string;
    now: Date;
  }): Appointment {
    if (input.slot.startsAt.getTime() <= input.now.getTime()) {
      throw new DomainError("No se puede agendar una visita en el pasado", {
        scheduledAt: input.slot.startsAt.toISOString(),
      });
    }

    const appointment = new Appointment({
      id: input.id,
      tenantId: input.tenantId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
      ...(input.propertyRef !== undefined ? { propertyRef: input.propertyRef } : {}),
      status: AppointmentStatus.REQUESTED,
      scheduledAt: input.slot.startsAt,
      durationMin: input.slot.durationMin,
      ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      requestedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    });

    appointment.record("requested", input.now, {
      scheduledAt: input.slot.startsAt.toISOString(),
      ...(input.propertyRef !== undefined ? { propertyRef: input.propertyRef } : {}),
    });

    return appointment;
  }

  static rehydrate(props: AppointmentProps): Appointment {
    return new Appointment(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get conversationId(): string {
    return this.props.conversationId;
  }
  get contactId(): string {
    return this.props.contactId;
  }
  get leadId(): string | undefined {
    return this.props.leadId;
  }
  get propertyRef(): string | undefined {
    return this.props.propertyRef;
  }
  get status(): AppointmentStatus {
    return this.props.status;
  }
  get scheduledAt(): Date {
    return this.props.scheduledAt;
  }
  get durationMin(): number {
    return this.props.durationMin;
  }
  get assignedUserId(): string | undefined {
    return this.props.assignedUserId;
  }
  get slot(): TimeSlot {
    return { startsAt: this.props.scheduledAt, durationMin: this.props.durationMin };
  }
  get isActive(): boolean {
    return ACTIVE_STATUSES.includes(this.props.status);
  }
  get reminderSentAt(): Date | undefined {
    return this.props.reminderSentAt;
  }

  confirm(now: Date): void {
    this.transition(AppointmentStatus.CONFIRMED, now);
    this.props = { ...this.props, confirmedAt: now };
    this.record("confirmed", now, {});
  }

  /**
   * Cambia la hora. Sigue siendo la misma cita —el cliente no ha cancelado
   * nada— y por eso conserva su id y su historial en vez de nacer otra.
   */
  reschedule(slot: TimeSlot, now: Date, reason?: string): void {
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new DomainError("No se puede reprogramar una visita al pasado", {
        scheduledAt: slot.startsAt.toISOString(),
      });
    }

    const previous = this.props.scheduledAt;
    this.transition(AppointmentStatus.RESCHEDULED, now);

    // Una cita movida vuelve a necesitar recordatorio: la marca se QUITA, no se
    // pone a `undefined` — con `exactOptionalPropertyTypes` no es lo mismo.
    const { reminderSentAt: _sent, ...rest } = this.props;
    this.props = {
      ...rest,
      scheduledAt: slot.startsAt,
      durationMin: slot.durationMin,
    };
    this.record("rescheduled", now, {
      from: previous.toISOString(),
      to: slot.startsAt.toISOString(),
      ...(reason ? { reason } : {}),
    });
  }

  cancel(now: Date, reason?: string): void {
    this.transition(AppointmentStatus.CANCELLED, now);
    this.props = {
      ...this.props,
      cancelledAt: now,
      ...(reason !== undefined ? { cancellationReason: reason } : {}),
    };
    this.record("cancelled", now, { ...(reason ? { reason } : {}) });
  }

  complete(now: Date): void {
    this.transition(AppointmentStatus.COMPLETED, now);
    this.record("completed", now, {});
  }

  markNoShow(now: Date): void {
    this.transition(AppointmentStatus.NO_SHOW, now);
    this.record("no_show", now, {});
  }

  assignTo(userId: string, now: Date): boolean {
    if (this.props.assignedUserId === userId) return false;
    this.props = { ...this.props, assignedUserId: userId, updatedAt: now };
    this.record("assigned", now, { userId });
    return true;
  }

  /** Idempotencia del recordatorio: se manda una vez por cita y hora. */
  markReminderSent(now: Date): boolean {
    if (this.props.reminderSentAt !== undefined) return false;
    this.props = { ...this.props, reminderSentAt: now, updatedAt: now };
    return true;
  }

  pullHistory(): AppointmentHistoryEntry[] {
    const entries = this.history;
    this.history = [];
    return entries;
  }

  snapshot(): AppointmentProps {
    return { ...this.props };
  }

  private transition(next: AppointmentStatus, now: Date): void {
    if (!TRANSITIONS[this.props.status].includes(next)) {
      throw new DomainError(`Una cita no puede pasar de ${this.props.status} a ${next}`, {
        appointmentId: this.props.id,
        from: this.props.status,
        to: next,
      });
    }
    this.props = { ...this.props, status: next, updatedAt: now };
  }

  private record(type: string, at: Date, payload: Readonly<Record<string, unknown>>): void {
    this.history.push({ type, at, payload });
  }
}
