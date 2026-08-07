import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import type { TimeSlot } from "../../domain/value-objects/time-slot";
import type { CalendarService } from "../../application/ports/calendar-service";

/**
 * Calendario interno: la agenda es lo que ya se ha agendado aquí.
 *
 * Es el adaptador "simple primero" que pedía el documento (§5.6) y hace su
 * trabajo sin ninguna suposición sobre proveedores externos: las citas vivas
 * ocupan su hueco y punto. El día que una inmobiliaria conecte Google Calendar,
 * ese adaptador implementará el mismo puerto y se compondrán los dos —lo que
 * bloquea la agenda pasa a ser la unión de ambos— sin tocar la política de
 * horarios ni el caso de uso.
 */
export class InternalCalendarService implements CalendarService {
  readonly source = "internal";

  constructor(private readonly deps: { appointments: AppointmentRepository }) {}

  async busyIntervals(input: {
    from: Date;
    to: Date;
    advisorId?: string;
  }): Promise<readonly TimeSlot[]> {
    const booked = await this.deps.appointments.listActiveBetween(
      input.from,
      input.to,
      input.advisorId,
    );

    return booked.map((appointment) => appointment.slot);
  }
}
