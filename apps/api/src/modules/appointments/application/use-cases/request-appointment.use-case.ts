import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import {
  ConflictError,
  ValidationError,
  type AppError,
} from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantDirectory } from "../../../identity";
import type { LeadService } from "../../../leads";
import { Appointment } from "../../domain/entities/appointment";
import { isWithinWorkingHours } from "../../domain/policies/business-hours.policy";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import { decodeSlot, slotsOverlap, type TimeSlot } from "../../domain/value-objects/time-slot";
import { AppointmentRequested, AppointmentRescheduled } from "../events/appointments.events";
import { formatSlot } from "../mappers/slot-label.mapper";
import type { AppointmentView, RequestAppointmentCommand } from "../ports/appointment-service";
import type { CalendarService } from "../ports/calendar-service";
import { resolveScheduling, SCHEDULING } from "../services/scheduling-settings";

/**
 * `RequestAppointment` — el momento en que la conversación deja de ser una
 * conversación y se convierte en una cita.
 *
 * Cuatro comprobaciones antes de escribir nada, y ninguna se puede saltar
 * aunque la franja venga de una referencia que nosotros mismos emitimos:
 *
 *  1. que la referencia sea legible;
 *  2. que caiga en horario de atención de ESTA inmobiliaria;
 *  3. que siga en el futuro y con la antelación mínima;
 *  4. que nadie la haya ocupado entre que se propuso y se aceptó.
 *
 * La cuarta es la importante: entre "¿te va bien el jueves a las 10?" y "sí"
 * pasan minutos reales, y en esos minutos otro cliente puede haber cogido el
 * hueco. Validar solo al proponer sería agendar dos visitas a la misma hora.
 *
 * Si la conversación ya tenía una cita viva, esto la MUEVE en lugar de crear
 * otra: cuando un cliente dice "mejor el viernes" no está pidiendo una segunda
 * visita, está cambiando la que ya tenía.
 */
export class RequestAppointmentUseCase {
  constructor(
    private readonly deps: {
      appointments: AppointmentRepository;
      leads: LeadService;
      tenants: TenantDirectory;
      calendar: CalendarService;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
    },
  ) {}

  async execute(
    command: RequestAppointmentCommand,
  ): Promise<Result<AppointmentView, AppError>> {
    const slot = decodeSlot(command.slotReference);
    if (!slot) {
      return err(
        new ValidationError("La franja indicada no es válida. Vuelve a proponer horarios."),
      );
    }

    const settings = await resolveScheduling(this.deps.tenants);
    const now = this.deps.clock.now();

    if (!isWithinWorkingHours(slot, settings.timezone, settings.hours)) {
      return err(
        new ValidationError("Esa hora queda fuera del horario de atención de la inmobiliaria."),
      );
    }

    if (slot.startsAt.getTime() < now.getTime() + SCHEDULING.minLeadMinutes * 60_000) {
      return err(
        new ValidationError(
          "Esa hora ya pasó o es demasiado pronto. Hace falta al menos dos horas de antelación.",
        ),
      );
    }

    const existing = await this.deps.appointments.findActiveByConversation(command.conversationId);

    // Misma cita, misma hora: la llamada se repitió. No es un error.
    const isSameSlot = existing?.scheduledAt.getTime() === slot.startsAt.getTime();
    if (existing && isSameSlot) {
      return ok(this.toView(existing, settings.timezone, settings.locale, false));
    }

    if (await this.isTaken(slot)) {
      return err(
        new ConflictError("Esa franja acaba de ocuparse. Ofrece otra de las disponibles.", {
          scheduledAt: slot.startsAt.toISOString(),
        }),
      );
    }

    return existing
      ? this.move(existing, slot, settings, command)
      : this.create(slot, settings, command, now);
  }

  /* ---------------------------------------------------------------------- */

  /**
   * ¿Está ocupada la franja?
   *
   * Al reprogramar no hace falta excluir la cita que se está moviendo: las
   * franjas caen en una rejilla fija, así que la vieja o es exactamente ésta
   * —caso que ya se resolvió más arriba como repetición— o no la toca.
   */
  private async isTaken(slot: TimeSlot): Promise<boolean> {
    const busy = await this.deps.calendar.busyIntervals({
      from: slot.startsAt,
      to: new Date(slot.startsAt.getTime() + slot.durationMin * 60_000),
    });

    return busy.some((taken) => slotsOverlap(slot, taken));
  }

  private async create(
    slot: TimeSlot,
    settings: { timezone: string; locale: string },
    command: RequestAppointmentCommand,
    now: Date,
  ): Promise<Result<AppointmentView, AppError>> {
    // La ficha comercial primero: una visita agendada sin lead es una visita
    // que nadie va a preparar. `capture` es idempotente, así que si el agente
    // ya registró el lead, esto solo lo actualiza.
    const lead = await this.deps.leads.capture({
      conversationId: command.conversationId,
      contactId: command.contactId,
      visitRequested: true,
    });

    const appointment = Appointment.request({
      id: this.deps.ids.generate(),
      tenantId: TenantContext.requireTenantId(),
      contactId: command.contactId,
      conversationId: command.conversationId,
      ...(isErr(lead) ? {} : { leadId: lead.value.id }),
      ...(command.propertyRef !== undefined ? { propertyRef: command.propertyRef } : {}),
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
      // El asesor de la cita es el del lead: el cliente no debería estrenar
      // interlocutor justo cuando por fin va a ver algo.
      ...(!isErr(lead) && lead.value.assignedUserId !== undefined
        ? { assignedUserId: lead.value.assignedUserId }
        : {}),
      slot,
      now,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.appointments.save(appointment);
      await this.deps.events.publish(AppointmentRequested, {
        appointmentId: appointment.id,
        conversationId: appointment.conversationId,
        contactId: appointment.contactId,
        ...(appointment.leadId !== undefined ? { leadId: appointment.leadId } : {}),
        ...(appointment.propertyRef !== undefined
          ? { propertyRef: appointment.propertyRef }
          : {}),
        scheduledAt: appointment.scheduledAt.toISOString(),
        durationMin: appointment.durationMin,
        ...(appointment.assignedUserId !== undefined
          ? { assignedUserId: appointment.assignedUserId }
          : {}),
      });
    });

    // El embudo del lead lo mueve `leads`, no nosotros: aquí solo se avisa.
    const marked = await this.deps.leads.markScheduled(command.conversationId);
    if (isErr(marked)) {
      this.deps.logger.warn("La cita se agendó pero el lead no cambió de estado", {
        conversationId: command.conversationId,
        errorCode: marked.error.code,
      });
    }

    return ok(this.toView(appointment, settings.timezone, settings.locale, false));
  }

  private async move(
    appointment: Appointment,
    slot: TimeSlot,
    settings: { timezone: string; locale: string },
    command: RequestAppointmentCommand,
  ): Promise<Result<AppointmentView, AppError>> {
    const previous = appointment.scheduledAt;
    appointment.reschedule(slot, this.deps.clock.now(), "cliente");

    await this.deps.unitOfWork.run(async () => {
      await this.deps.appointments.save(appointment);
      await this.deps.events.publish(AppointmentRescheduled, {
        appointmentId: appointment.id,
        conversationId: command.conversationId,
        from: previous.toISOString(),
        to: slot.startsAt.toISOString(),
      });
    });

    return ok(this.toView(appointment, settings.timezone, settings.locale, true));
  }

  private toView(
    appointment: Appointment,
    timezone: string,
    locale: string,
    rescheduled: boolean,
  ): AppointmentView {
    return {
      id: appointment.id,
      status: appointment.status,
      scheduledAt: appointment.scheduledAt,
      label: formatSlot(appointment.slot, timezone, locale),
      ...(appointment.propertyRef !== undefined
        ? { propertyRef: appointment.propertyRef }
        : {}),
      ...(appointment.assignedUserId !== undefined
        ? { assignedUserId: appointment.assignedUserId }
        : {}),
      rescheduled,
    };
  }
}
