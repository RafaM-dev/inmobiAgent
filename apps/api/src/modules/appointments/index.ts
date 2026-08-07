import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { EventSubscription } from "../../platform/events/event";
import type { ConversationCradle } from "../conversation";
import { requireSession, type IdentityCradle } from "../identity";
import type { LeadsCradle } from "../leads";
import { ListAppointmentsUseCase } from "./application/use-cases/list-appointments.use-case";
import { registerAppointmentsRoutes } from "./interface/http/appointments.routes";
import { onReminderDue } from "./application/event-handlers/on-reminder-due";
import type { AppointmentService } from "./application/ports/appointment-service";
import type { CalendarService } from "./application/ports/calendar-service";
import { AppointmentServiceFacade } from "./application/services/appointment-service.facade";
import {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
} from "./application/use-cases/manage-appointment.use-cases";
import { ProposeAppointmentSlotsUseCase } from "./application/use-cases/propose-appointment-slots.use-case";
import { RequestAppointmentUseCase } from "./application/use-cases/request-appointment.use-case";
import { ScanDueRemindersUseCase } from "./application/use-cases/scan-due-reminders.use-case";
import type { AppointmentRepository } from "./domain/repositories/appointment.repository";
import { InternalCalendarService } from "./infrastructure/calendar/internal-calendar.service";
import { PrismaAppointmentRepository } from "./infrastructure/persistence/prisma/prisma-appointment.repository";
import { InProcessReminderScheduler } from "./infrastructure/scheduling/in-process-reminder-scheduler";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `appointments`
 *
 * La agenda de visitas. Depende de `leads` en un solo sentido —agendar mueve el
 * embudo— y nunca al revés: un lead no sabe de citas, y por eso el back-office
 * podrá agendar sin pasar por una conversación.
 * ========================================================================== */

export type {
  AppointmentService,
  AppointmentView,
  ProposedSlot,
  ProposeSlotsCommand,
  ProposeSlotsResult,
  RequestAppointmentCommand,
} from "./application/ports/appointment-service";
export type { CalendarService } from "./application/ports/calendar-service";
export { AppointmentStatus } from "./domain/entities/appointment";
export type { TimeSlot } from "./domain/value-objects/time-slot";
export { SCHEDULING } from "./application/services/scheduling-settings";
export {
  AppointmentRequested,
  AppointmentConfirmed,
  AppointmentRescheduled,
  AppointmentCancelled,
  AppointmentReminderDue,
  type AppointmentRequestedPayload,
  type AppointmentConfirmedPayload,
  type AppointmentRescheduledPayload,
  type AppointmentCancelledPayload,
  type AppointmentReminderDuePayload,
} from "./application/events/appointments.events";

export interface AppointmentsCradle {
  appointmentRepository: AppointmentRepository;
  calendarService: CalendarService;
  proposeAppointmentSlots: ProposeAppointmentSlotsUseCase;
  requestAppointment: RequestAppointmentUseCase;
  confirmAppointment: ConfirmAppointmentUseCase;
  cancelAppointment: CancelAppointmentUseCase;
  scanDueReminders: ScanDueRemindersUseCase;
  listAppointments: ListAppointmentsUseCase;
  reminderScheduler: InProcessReminderScheduler;
  /** Puerto público: es lo que consume el agente. */
  appointmentService: AppointmentService;
}

type Cradle = PlatformCradle &
  IdentityCradle &
  ConversationCradle &
  LeadsCradle &
  AppointmentsCradle;

export const appointmentsModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "appointments",

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      appointmentRepository: asFunction(
        (c: Cradle): AppointmentRepository => new PrismaAppointmentRepository(c.database, c.ids),
      ).singleton(),

      /**
       * ÚNICO punto donde se elige de dónde sale la disponibilidad. Hoy, de las
       * citas ya agendadas. Un calendario externo implementará este mismo puerto
       * y se añadirá aquí; ni la política de horarios ni los casos de uso
       * cambian.
       */
      calendarService: asFunction(
        (c: Cradle): CalendarService =>
          new InternalCalendarService({ appointments: c.appointmentRepository }),
      ).singleton(),

      proposeAppointmentSlots: asFunction(
        (c: Cradle) =>
          new ProposeAppointmentSlotsUseCase({
            tenants: c.tenantDirectory,
            calendar: c.calendarService,
            clock: c.clock,
          }),
      ).singleton(),

      requestAppointment: asFunction(
        (c: Cradle) =>
          new RequestAppointmentUseCase({
            appointments: c.appointmentRepository,
            leads: c.leadService,
            tenants: c.tenantDirectory,
            calendar: c.calendarService,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
            logger: c.logger.child({ module: "appointments" }),
          }),
      ).singleton(),

      confirmAppointment: asFunction(
        (c: Cradle) =>
          new ConfirmAppointmentUseCase({
            appointments: c.appointmentRepository,
            tenants: c.tenantDirectory,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      cancelAppointment: asFunction(
        (c: Cradle) =>
          new CancelAppointmentUseCase({
            appointments: c.appointmentRepository,
            tenants: c.tenantDirectory,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      scanDueReminders: asFunction(
        (c: Cradle) =>
          new ScanDueRemindersUseCase({
            appointments: c.appointmentRepository,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "appointments" }),
          }),
      ).singleton(),

      listAppointments: asFunction(
        (c: Cradle) =>
          new ListAppointmentsUseCase({
            appointments: c.appointmentRepository,
            tenants: c.tenantDirectory,
            clock: c.clock,
          }),
      ).singleton(),

      reminderScheduler: asFunction(
        (c: Cradle) =>
          new InProcessReminderScheduler({
            scan: c.scanDueReminders,
            appointments: c.appointmentRepository,
            clock: c.clock,
            logger: c.logger.child({ module: "appointments", component: "reminders" }),
          }),
      ).singleton(),

      appointmentService: asFunction(
        (c: Cradle): AppointmentService =>
          new AppointmentServiceFacade({
            propose: c.proposeAppointmentSlots,
            request: c.requestAppointment,
            confirm: c.confirmAppointment,
            cancel: c.cancelAppointment,
            appointments: c.appointmentRepository,
            tenants: c.tenantDirectory,
          }),
      ).singleton(),
    });
  },

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerAppointmentsRoutes(app, {
      listAppointments: cradle.listAppointments,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
    });
  },

  registerSubscriptions(cradle: Cradle): EventSubscription[] {
    return [
      onReminderDue({
        conversations: cradle.conversationService,
        tenants: cradle.tenantDirectory,
        logger: cradle.logger.child({ module: "appointments" }),
      }),
    ];
  },

  onStart(cradle: Cradle): void {
    cradle.reminderScheduler.start();
  },

  onStop(cradle: Cradle): void {
    cradle.reminderScheduler.stop();
  },
};
