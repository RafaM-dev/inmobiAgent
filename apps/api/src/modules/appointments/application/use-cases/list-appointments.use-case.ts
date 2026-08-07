import type { Clock } from "../../../../platform/clock/clock";
import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type { TenantDirectory } from "../../../identity";
import type { Appointment } from "../../domain/entities/appointment";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import { formatSlot } from "../mappers/slot-label.mapper";
import { resolveScheduling } from "../services/scheduling-settings";

export interface ListAppointmentsCommand {
  /** Días hacia adelante desde ahora. */
  readonly days?: number;
  readonly assignedUserId?: string;
}

export interface AppointmentListItem {
  readonly appointment: Appointment;
  /** Hora ya escrita en la zona horaria de la inmobiliaria. */
  readonly label: string;
}

const DEFAULT_DAYS = 7;

/**
 * Agenda del back-office.
 *
 * Devuelve la etiqueta ya formateada, no una fecha cruda: la hora de una visita
 * es de la inmobiliaria, y dejar que el navegador la interprete con su propia
 * zona horaria es cómo un asesor en otro país acaba llamando a un cliente a las
 * seis de la mañana.
 */
export class ListAppointmentsUseCase {
  constructor(
    private readonly deps: {
      appointments: AppointmentRepository;
      tenants: TenantDirectory;
      clock: Clock;
    },
  ) {}

  async execute(
    command: ListAppointmentsCommand = {},
  ): Promise<Result<readonly AppointmentListItem[], AppError>> {
    const settings = await resolveScheduling(this.deps.tenants);
    const now = this.deps.clock.now();
    const until = new Date(now.getTime() + (command.days ?? DEFAULT_DAYS) * 86_400_000);

    const found = await this.deps.appointments.listActiveBetween(
      now,
      until,
      command.assignedUserId,
    );

    return ok(
      found.map((appointment) => ({
        appointment,
        label: formatSlot(appointment.slot, settings.timezone, settings.locale),
      })),
    );
  }
}
