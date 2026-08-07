import type { Clock } from "../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../platform/database/unit-of-work";
import type { EventPublisher } from "../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../platform/ids/id-generator";
import type { Logger } from "../../../platform/logging/logger";
import type { TenantDirectory } from "../../identity";
import type { LeadService } from "../../leads";
import type { AppointmentService } from "../application/ports/appointment-service";
import { AppointmentServiceFacade } from "../application/services/appointment-service.facade";
import {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
} from "../application/use-cases/manage-appointment.use-cases";
import { ProposeAppointmentSlotsUseCase } from "../application/use-cases/propose-appointment-slots.use-case";
import { RequestAppointmentUseCase } from "../application/use-cases/request-appointment.use-case";
import { ScanDueRemindersUseCase } from "../application/use-cases/scan-due-reminders.use-case";
import { InternalCalendarService } from "../infrastructure/calendar/internal-calendar.service";
import { InMemoryAppointmentRepository } from "./in-memory-appointment.repository";

/**
 * La agenda completa en memoria, con los casos de uso REALES y el calendario
 * interno de verdad. Igual que `createInMemoryLeads`: permite que otro módulo
 * —el agente— se pruebe contra citas que se comportan como las de producción
 * sin importar nada de dentro de éste.
 */
export interface InMemoryAppointments {
  readonly service: AppointmentService;
  readonly repository: InMemoryAppointmentRepository;
  readonly scanReminders: ScanDueRemindersUseCase;
}

export const createInMemoryAppointments = (deps: {
  tenants: TenantDirectory;
  leads: LeadService;
  events: EventPublisher;
  clock: Clock;
  logger: Logger;
}): InMemoryAppointments => {
  const repository = new InMemoryAppointmentRepository();
  const calendar = new InternalCalendarService({ appointments: repository });
  const unitOfWork = new NoopUnitOfWork();

  const propose = new ProposeAppointmentSlotsUseCase({
    tenants: deps.tenants,
    calendar,
    clock: deps.clock,
  });

  const request = new RequestAppointmentUseCase({
    appointments: repository,
    leads: deps.leads,
    tenants: deps.tenants,
    calendar,
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
    ids: new SequentialIdGenerator("appt"),
    logger: deps.logger,
  });

  const manageDeps = {
    appointments: repository,
    tenants: deps.tenants,
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
  };

  return {
    repository,
    scanReminders: new ScanDueRemindersUseCase({
      appointments: repository,
      unitOfWork,
      events: deps.events,
      clock: deps.clock,
      logger: deps.logger,
    }),
    service: new AppointmentServiceFacade({
      propose,
      request,
      confirm: new ConfirmAppointmentUseCase(manageDeps),
      cancel: new CancelAppointmentUseCase(manageDeps),
      appointments: repository,
      tenants: deps.tenants,
    }),
  };
};
