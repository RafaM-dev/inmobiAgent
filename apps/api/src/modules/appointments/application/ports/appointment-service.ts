import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { AppointmentStatus } from "../../domain/entities/appointment";

/**
 * PUERTO PÚBLICO de `appointments` (docs §8.2, `AppointmentService`).
 *
 * El agente lo conoce a través de dos herramientas: una que propone y otra que
 * agenda. Nunca ve una fecha suelta ni un identificador de agenda: recibe
 * franjas con su etiqueta ya escrita y devuelve la referencia de la que eligió
 * el cliente. Esa asimetría es deliberada — es lo que hace imposible que el
 * modelo agende una hora que nadie le ofreció.
 */

export interface ProposedSlot {
  /** Referencia opaca. Es lo único que el modelo puede devolver. */
  readonly reference: string;
  /** Texto ya redactado en la zona horaria del tenant. */
  readonly label: string;
  readonly startsAt: Date;
}

export interface ProposeSlotsCommand {
  readonly conversationId: string;
  /** Día que pidió el cliente, si lo dijo. Ordena, no filtra. */
  readonly preferredDate?: Date;
  readonly limit?: number;
}

export interface ProposeSlotsResult {
  readonly slots: readonly ProposedSlot[];
  readonly timezone: string;
}

export interface RequestAppointmentCommand {
  readonly conversationId: string;
  readonly contactId: string;
  readonly slotReference: string;
  /** Inmueble a visitar, en formato `"source:externalId"`. */
  readonly propertyRef?: string;
  readonly notes?: string;
}

export interface AppointmentView {
  readonly id: string;
  readonly status: AppointmentStatus;
  readonly scheduledAt: Date;
  readonly label: string;
  readonly propertyRef?: string;
  readonly assignedUserId?: string;
  /** `true` si esta llamada movió una cita que ya existía. */
  readonly rescheduled: boolean;
}

export interface AppointmentService {
  proposeSlots(command: ProposeSlotsCommand): Promise<Result<ProposeSlotsResult, AppError>>;
  request(command: RequestAppointmentCommand): Promise<Result<AppointmentView, AppError>>;
  confirm(appointmentId: string): Promise<Result<AppointmentView, AppError>>;
  cancel(appointmentId: string, reason?: string): Promise<Result<AppointmentView, AppError>>;
  findActiveByConversation(
    conversationId: string,
  ): Promise<Result<AppointmentView | null, AppError>>;
}
