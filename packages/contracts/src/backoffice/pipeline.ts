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
  /**
   * A qué estados puede pasar ESTE lead, calculado por el servidor.
   *
   * Viaja con cada fila en vez de que el panel se sepa el embudo de memoria. La
   * tabla de transiciones es una regla de negocio y vive en el agregado `Lead`;
   * duplicarla en el navegador significaría que algún día cambian una y no la
   * otra, y el síntoma sería un menú que ofrece un cambio que el servidor
   * después rechaza —o peor, que esconde uno que sí era válido—.
   *
   * Un terminal (`WON`, `LOST`) devuelve la lista vacía, y eso el panel lo pinta
   * como "sin acciones" sin necesitar saber por qué.
   */
  allowedTransitions: z.array(leadStatusSchema),
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

/**
 * Mover un lead por el embudo.
 *
 * El motivo es opcional y libre porque es lo que un asesor escribe cuando marca
 * "Perdido": «se fue con la competencia», «no le dio el crédito». Acaba en el
 * histórico del lead, que es donde alguien lo leerá dentro de seis meses al
 * preguntarse por qué se cayó esta operación.
 */
export const changeLeadStatusSchema = z.object({
  status: leadStatusSchema,
  reason: z.string().trim().min(1).max(280).optional(),
});
export type ChangeLeadStatusRequest = z.infer<typeof changeLeadStatusSchema>;

/**
 * Asignar el lead a alguien del equipo.
 *
 * `null` lo deja sin dueño. Es un caso real —el asesor se va de vacaciones y el
 * lead vuelve al montón— y por eso se distingue de "no envío el campo": omitirlo
 * sería ambiguo entre "quítalo" y "déjalo como está".
 */
export const assignLeadSchema = z.object({
  userId: idSchema.nullable(),
});
export type AssignLeadRequest = z.infer<typeof assignLeadSchema>;

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

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(1).max(280).optional(),
});
export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentSchema>;

/**
 * Lo que devuelve confirmar o cancelar: SOLO lo que cambia.
 *
 * No es un resumen recortado por pereza. El inmueble, el contacto y la duración
 * no los toca ninguna de las dos operaciones, así que devolverlos invitaría a
 * pisar con ellos lo que el panel ya tiene —y a que un campo que el servidor no
 * ha recalculado parezca recién traído—. Con esto el panel parchea tres campos
 * de la fila y no necesita recargar la agenda entera.
 */
export const appointmentActionResponseSchema = z.object({
  id: idSchema,
  status: appointmentStatusSchema,
  scheduledAt: isoDateTimeSchema,
  label: z.string(),
});
export type AppointmentActionResponse = z.infer<typeof appointmentActionResponseSchema>;
