import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common/primitives";

/**
 * Embudo comercial: leads y citas.
 *
 * Lo que se publica es lo que un asesor necesita para decidir a quién llamar,
 * no el agregado entero. La puntuación viaja con sus MOTIVOS porque un número
 * suelto no ayuda a nadie a empezar una conversación.
 */

export const leadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "SCHEDULED",
  "WON",
  "LOST",
]);
export type LeadStatusContract = z.infer<typeof leadStatusSchema>;

export const leadBandSchema = z.enum(["COLD", "WARM", "HOT"]);
export type LeadBandContract = z.infer<typeof leadBandSchema>;

export const leadSummarySchema = z.object({
  id: idSchema,
  contactId: idSchema,
  conversationId: idSchema,
  status: leadStatusSchema,
  score: z.number().int(),
  band: leadBandSchema,
  assignedUserId: idSchema.optional(),
  interestCount: z.number().int(),
  lastActivityAt: isoDateTimeSchema,
});
export type LeadSummaryContract = z.infer<typeof leadSummarySchema>;

export const leadListQuerySchema = z.object({
  status: leadStatusSchema.optional(),
  band: leadBandSchema.optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const leadListResponseSchema = z.object({ items: z.array(leadSummarySchema) });
export type LeadListResponse = z.infer<typeof leadListResponseSchema>;

/* -------------------------------------------------------------------------- */

export const appointmentStatusSchema = z.enum([
  "REQUESTED",
  "CONFIRMED",
  "RESCHEDULED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
]);
export type AppointmentStatusContract = z.infer<typeof appointmentStatusSchema>;

export const appointmentSummarySchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  contactId: idSchema,
  leadId: idSchema.optional(),
  propertyRef: z.string().optional(),
  status: appointmentStatusSchema,
  scheduledAt: isoDateTimeSchema,
  /** Ya escrito en la zona horaria de la inmobiliaria. */
  label: z.string(),
  durationMin: z.number().int(),
  assignedUserId: idSchema.optional(),
});
export type AppointmentSummaryContract = z.infer<typeof appointmentSummarySchema>;

export const appointmentListQuerySchema = z.object({
  /** Días hacia adelante desde hoy. Por defecto, la semana. */
  days: z.coerce.number().int().min(1).max(90).default(7),
  mine: z.coerce.boolean().optional(),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

export const appointmentListResponseSchema = z.object({
  items: z.array(appointmentSummarySchema),
});
export type AppointmentListResponse = z.infer<typeof appointmentListResponseSchema>;
