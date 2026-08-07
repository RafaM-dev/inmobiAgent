import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { TenantDirectory } from "../../../identity";
import type { Appointment } from "../../domain/entities/appointment";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import { AppointmentCancelled, AppointmentConfirmed } from "../events/appointments.events";
import { formatSlot } from "../mappers/slot-label.mapper";
import type { AppointmentView } from "../ports/appointment-service";
import { resolveScheduling } from "../services/scheduling-settings";

/**
 * Confirmar y cancelar.
 *
 * Van juntas porque son la misma operación con distinto signo: leer la cita,
 * pedirle al agregado un cambio de estado que él valida, guardar y publicar.
 * Reprogramar NO está aquí: la hace `RequestAppointment`, porque desde la
 * conversación "mejor el viernes" y "quiero el viernes" son el mismo gesto.
 */

interface Deps {
  appointments: AppointmentRepository;
  tenants: TenantDirectory;
  unitOfWork: UnitOfWork;
  events: EventPublisher;
  clock: Clock;
}

const toView = (
  appointment: Appointment,
  timezone: string,
  locale: string,
): AppointmentView => ({
  id: appointment.id,
  status: appointment.status,
  scheduledAt: appointment.scheduledAt,
  label: formatSlot(appointment.slot, timezone, locale),
  ...(appointment.propertyRef !== undefined ? { propertyRef: appointment.propertyRef } : {}),
  ...(appointment.assignedUserId !== undefined
    ? { assignedUserId: appointment.assignedUserId }
    : {}),
  rescheduled: false,
});

export class ConfirmAppointmentUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(appointmentId: string): Promise<Result<AppointmentView, AppError>> {
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment) return err(new NotFoundError("Cita", appointmentId));

    const settings = await resolveScheduling(this.deps.tenants);

    // Confirmar dos veces no es un error del cliente: es que pulsó dos veces.
    if (appointment.status === "CONFIRMED") {
      return ok(toView(appointment, settings.timezone, settings.locale));
    }

    appointment.confirm(this.deps.clock.now());

    await this.deps.unitOfWork.run(async () => {
      await this.deps.appointments.save(appointment);
      await this.deps.events.publish(AppointmentConfirmed, {
        appointmentId: appointment.id,
        conversationId: appointment.conversationId,
        scheduledAt: appointment.scheduledAt.toISOString(),
      });
    });

    return ok(toView(appointment, settings.timezone, settings.locale));
  }
}

export class CancelAppointmentUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(
    appointmentId: string,
    reason?: string,
  ): Promise<Result<AppointmentView, AppError>> {
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (!appointment) return err(new NotFoundError("Cita", appointmentId));

    const settings = await resolveScheduling(this.deps.tenants);

    if (appointment.status === "CANCELLED") {
      return ok(toView(appointment, settings.timezone, settings.locale));
    }

    const scheduledAt = appointment.scheduledAt;
    appointment.cancel(this.deps.clock.now(), reason);

    await this.deps.unitOfWork.run(async () => {
      await this.deps.appointments.save(appointment);
      await this.deps.events.publish(AppointmentCancelled, {
        appointmentId: appointment.id,
        conversationId: appointment.conversationId,
        scheduledAt: scheduledAt.toISOString(),
        ...(reason ? { reason } : {}),
      });
    });

    return ok(toView(appointment, settings.timezone, settings.locale));
  }
}
