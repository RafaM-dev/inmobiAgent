import type { Clock } from "../../../../platform/clock/clock";
import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type { TenantDirectory } from "../../../identity";
import { proposeSlots } from "../../domain/policies/business-hours.policy";
import { encodeSlot } from "../../domain/value-objects/time-slot";
import { formatSlot } from "../mappers/slot-label.mapper";
import type {
  ProposeSlotsCommand,
  ProposeSlotsResult,
  ProposedSlot,
} from "../ports/appointment-service";
import type { CalendarService } from "../ports/calendar-service";
import { resolveScheduling, SCHEDULING } from "../services/scheduling-settings";

/**
 * `ProposeAppointmentSlots` — qué horas se le pueden ofrecer al cliente.
 *
 * Es puro cálculo salvo dos consultas: el horario de la inmobiliaria y los
 * huecos ya ocupados. Ninguna de las dos depende del modelo de IA, y esa es la
 * gracia: las franjas que ve el cliente son las que existen de verdad.
 *
 * Es **determinista dentro de una misma hora**: llamarla dos veces seguidas
 * devuelve las mismas franjas. Importa más de lo que parece — el cliente
 * responde "la segunda" en el turno siguiente, y para entonces la herramienta
 * vuelve a proponer y la segunda sigue siendo la segunda.
 */
export class ProposeAppointmentSlotsUseCase {
  constructor(
    private readonly deps: {
      tenants: TenantDirectory;
      calendar: CalendarService;
      clock: Clock;
    },
  ) {}

  async execute(command: ProposeSlotsCommand): Promise<Result<ProposeSlotsResult, AppError>> {
    const settings = await resolveScheduling(this.deps.tenants);
    const now = this.deps.clock.now();
    const horizonEnd = new Date(now.getTime() + SCHEDULING.horizonDays * 86_400_000);

    const busy = await this.deps.calendar.busyIntervals({ from: now, to: horizonEnd });

    const slots = proposeSlots({
      now,
      timezone: settings.timezone,
      hours: settings.hours,
      durationMin: SCHEDULING.durationMin,
      minLeadMinutes: SCHEDULING.minLeadMinutes,
      horizonDays: SCHEDULING.horizonDays,
      limit: command.limit ?? SCHEDULING.proposalLimit,
      busy,
      ...(command.preferredDate ? { preferredDate: command.preferredDate } : {}),
    });

    return ok({
      timezone: settings.timezone,
      slots: slots.map(
        (slot): ProposedSlot => ({
          reference: encodeSlot(slot),
          label: formatSlot(slot, settings.timezone, settings.locale),
          startsAt: slot.startsAt,
        }),
      ),
    });
  }
}
