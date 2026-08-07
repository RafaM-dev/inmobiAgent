import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `leads`.
 *
 * Son el contrato con el resto del producto: `notifications` avisará al asesor
 * (F5), `appointments` reacciona a la cita, y el back-office (F7) refrescará la
 * bandeja en vivo. Ninguno de ellos necesitará conocer este módulo por dentro.
 */

export interface LeadCapturedPayload {
  readonly leadId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly source: string;
}

export const LeadCaptured = defineEvent<LeadCapturedPayload>("lead.captured");

export interface LeadQualifiedPayload {
  readonly leadId: string;
  readonly conversationId: string;
  readonly score: number;
  readonly band: string;
  /** Códigos de los motivos, en orden de peso. Sirve para analítica. */
  readonly reasons: readonly string[];
}

export const LeadQualified = defineEvent<LeadQualifiedPayload>("lead.qualified");

export interface LeadAssignedPayload {
  readonly leadId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly score: number;
}

export const LeadAssigned = defineEvent<LeadAssignedPayload>("lead.assigned");

export interface LeadStatusChangedPayload {
  readonly leadId: string;
  readonly conversationId: string;
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
}

export const LeadStatusChanged = defineEvent<LeadStatusChangedPayload>("lead.status_changed");
