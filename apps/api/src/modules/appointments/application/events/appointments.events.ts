import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `appointments`.
 *
 * `AppointmentReminderDue` es el único que hoy tiene consumidor dentro del
 * propio módulo: el job detecta que toca avisar y publica; un handler envía el
 * mensaje por el canal del cliente. Separarlos no es ceremonia — es lo que
 * permitirá que en F5 `notifications` avise también al asesor por correo sin
 * tocar el job, y que en F9 el envío se reintente por su cuenta.
 */

export interface AppointmentRequestedPayload {
  readonly appointmentId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly leadId?: string;
  readonly propertyRef?: string;
  readonly scheduledAt: string;
  readonly durationMin: number;
  readonly assignedUserId?: string;
}

export const AppointmentRequested = defineEvent<AppointmentRequestedPayload>(
  "appointment.requested",
);

export interface AppointmentConfirmedPayload {
  readonly appointmentId: string;
  readonly conversationId: string;
  readonly scheduledAt: string;
}

export const AppointmentConfirmed = defineEvent<AppointmentConfirmedPayload>(
  "appointment.confirmed",
);

export interface AppointmentRescheduledPayload {
  readonly appointmentId: string;
  readonly conversationId: string;
  readonly from: string;
  readonly to: string;
}

export const AppointmentRescheduled = defineEvent<AppointmentRescheduledPayload>(
  "appointment.rescheduled",
);

export interface AppointmentCancelledPayload {
  readonly appointmentId: string;
  readonly conversationId: string;
  readonly scheduledAt: string;
  readonly reason?: string;
}

export const AppointmentCancelled = defineEvent<AppointmentCancelledPayload>(
  "appointment.cancelled",
);

export interface AppointmentReminderDuePayload {
  readonly appointmentId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly scheduledAt: string;
  readonly propertyRef?: string;
}

export const AppointmentReminderDue = defineEvent<AppointmentReminderDuePayload>(
  "appointment.reminder_due",
);
