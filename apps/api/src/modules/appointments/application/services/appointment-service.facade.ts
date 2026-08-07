import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type { TenantDirectory } from "../../../identity";
import type { AppointmentRepository } from "../../domain/repositories/appointment.repository";
import { formatSlot } from "../mappers/slot-label.mapper";
import type {
  AppointmentService,
  AppointmentView,
  ProposeSlotsCommand,
  ProposeSlotsResult,
  RequestAppointmentCommand,
} from "../ports/appointment-service";
import { resolveScheduling } from "./scheduling-settings";
import type {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
} from "../use-cases/manage-appointment.use-cases";
import type { ProposeAppointmentSlotsUseCase } from "../use-cases/propose-appointment-slots.use-case";
import type { RequestAppointmentUseCase } from "../use-cases/request-appointment.use-case";

/** Implementación del puerto público. Delega; no decide nada. */
export class AppointmentServiceFacade implements AppointmentService {
  constructor(
    private readonly deps: {
      propose: ProposeAppointmentSlotsUseCase;
      request: RequestAppointmentUseCase;
      confirm: ConfirmAppointmentUseCase;
      cancel: CancelAppointmentUseCase;
      appointments: AppointmentRepository;
      tenants: TenantDirectory;
    },
  ) {}

  proposeSlots(command: ProposeSlotsCommand): Promise<Result<ProposeSlotsResult, AppError>> {
    return this.deps.propose.execute(command);
  }

  request(command: RequestAppointmentCommand): Promise<Result<AppointmentView, AppError>> {
    return this.deps.request.execute(command);
  }

  confirm(appointmentId: string): Promise<Result<AppointmentView, AppError>> {
    return this.deps.confirm.execute(appointmentId);
  }

  cancel(appointmentId: string, reason?: string): Promise<Result<AppointmentView, AppError>> {
    return this.deps.cancel.execute(appointmentId, reason);
  }

  async findActiveByConversation(
    conversationId: string,
  ): Promise<Result<AppointmentView | null, AppError>> {
    const appointment = await this.deps.appointments.findActiveByConversation(conversationId);
    if (!appointment) return ok(null);

    const settings = await resolveScheduling(this.deps.tenants);

    return ok({
      id: appointment.id,
      status: appointment.status,
      scheduledAt: appointment.scheduledAt,
      label: formatSlot(appointment.slot, settings.timezone, settings.locale),
      ...(appointment.propertyRef !== undefined
        ? { propertyRef: appointment.propertyRef }
        : {}),
      ...(appointment.assignedUserId !== undefined
        ? { assignedUserId: appointment.assignedUserId }
        : {}),
      rescheduled: false,
    });
  }
}
