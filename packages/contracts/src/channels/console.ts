import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common/primitives";
import { replyBlockSchema } from "../backoffice/blocks";

/**
 * Canal de consola: el transporte que usa el simulador del back-office.
 *
 * Esto NO es una API interna del panel. Es exactamente la misma ruta pública por
 * la que hablaría un cliente final, y ese es el punto del simulador: lo que un
 * asesor prueba es el camino real —mismo caso de uso, mismo agente, mismas
 * herramientas— y no un atajo que podría comportarse distinto justo el día que
 * importa.
 *
 * Por eso el mensaje entrante no lleva `tenantId`: el tenant se deduce de la
 * cuenta de canal por la que entra, jamás del cuerpo.
 */

export const consoleInboundRequestSchema = z.object({
  /** Quién escribe, en el "proveedor". Aquí lo inventa el simulador. */
  from: z.string().min(1).max(120),
  displayName: z.string().max(120).optional(),
  text: z.string().min(1).max(2000),
});
export type ConsoleInboundRequest = z.infer<typeof consoleInboundRequestSchema>;

export const consoleAcceptedResponseSchema = z.object({
  accepted: z.boolean(),
  externalMessageIds: z.array(z.string()),
});
export type ConsoleAcceptedResponse = z.infer<typeof consoleAcceptedResponseSchema>;

/**
 * Lo que llega por el flujo SSE cuando el agente responde.
 *
 * `to` es el destinatario: el flujo es de la CUENTA de canal, no de una
 * conversación, así que quien escucha tiene que quedarse solo con lo suyo. Sin
 * ese filtro, dos simuladores abiertos a la vez verían las respuestas del otro.
 */
export const consoleStreamMessageSchema = z.object({
  conversationId: idSchema,
  messageId: idSchema,
  to: z.string(),
  blocks: z.array(replyBlockSchema),
  sentAt: isoDateTimeSchema,
});
export type ConsoleStreamMessage = z.infer<typeof consoleStreamMessageSchema>;

export const consoleStreamReadySchema = z.object({
  channelAccountId: idSchema,
  channelType: z.string(),
  displayName: z.string(),
});
export type ConsoleStreamReady = z.infer<typeof consoleStreamReadySchema>;
