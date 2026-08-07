import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import { AppointmentReminderDue } from "../events/appointments.events";
import { SCHEDULING } from "../services/scheduling-settings";

/** Tope por pasada: si hay más, se recogen en la siguiente. */
const BATCH = 50;

/**
 * `SendAppointmentReminder` (docs §6) — el job que avisa antes de la visita.
 *
 * NO envía nada. Detecta qué citas toca recordar, marca la marca de agua y
 * publica `appointment.reminder_due`. Quién y cómo avisa es problema de un
 * consumidor: hoy un handler de este mismo módulo escribe al cliente por su
 * canal; en F5 `notifications` avisará también al asesor por correo sin que
 * este job se entere.
 *
 * La idempotencia está en el agregado (`reminderSentAt`), no en el planificador:
 * da igual que el job corra dos veces o que el proceso se reinicie a mitad —el
 * cliente recibe un recordatorio, no dos.
 */
export class ScanDueRemindersUseCase {
  constructor(
    private readonly deps: {
      appointments: AppointmentRepository;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(): Promise<number> {
    const now = this.deps.clock.now();
    const until = new Date(now.getTime() + SCHEDULING.reminderHours * 3_600_000);

    const due = await this.deps.appointments.listPendingReminders(until, now, BATCH);
    let sent = 0;

    for (const appointment of due) {
      if (!appointment.markReminderSent(now)) continue;

      await this.deps.unitOfWork.run(async () => {
        await this.deps.appointments.save(appointment);
        await this.deps.events.publish(
          AppointmentReminderDue,
          {
            appointmentId: appointment.id,
            conversationId: appointment.conversationId,
            contactId: appointment.contactId,
            scheduledAt: appointment.scheduledAt.toISOString(),
            ...(appointment.propertyRef !== undefined
              ? { propertyRef: appointment.propertyRef }
              : {}),
          },
          // El job recorre varias inmobiliarias; cada evento lleva la suya.
          { tenantId: appointment.tenantId },
        );
      });

      sent += 1;
    }

    if (sent > 0) {
      this.deps.logger.info("Recordatorios de visita encolados", { count: sent });
    }
    return sent;
  }

  /**
   * Ejecuta la pasada dentro del contexto de un tenant concreto. El planificador
   * no tiene `TenantContext` propio, y los repositorios lo exigen: sin esto, un
   * job leería datos de todas las inmobiliarias a la vez.
   */
  runFor(tenantId: string): Promise<number> {
    return TenantContext.run(
      { tenantId, correlationId: `reminders-${tenantId}`, source: "job" },
      () => this.execute(),
    );
  }
}
