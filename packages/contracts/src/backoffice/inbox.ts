import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common/primitives";
import { replyBlockSchema } from "./blocks";

/** Canales por los que puede entrar una conversación. */
export const channelTypeSchema = z.enum([
  "CONSOLE",
  "WEBCHAT",
  "WHATSAPP",
  "TELEGRAM",
  "MESSENGER",
  "INSTAGRAM",
]);
export type ChannelTypeContract = z.infer<typeof channelTypeSchema>;

/**
 * Estado de control de la conversación.
 *
 * `BOT_PAUSED` y `HUMAN` no son lo mismo: en la primera el bot se calló solo
 * (escaló), en la segunda un asesor la tomó. El inbox las muestra distinto
 * porque exigen acciones distintas.
 */
export const conversationStatusSchema = z.enum(["OPEN", "BOT_PAUSED", "HUMAN", "CLOSED"]);
export type ConversationStatusContract = z.infer<typeof conversationStatusSchema>;

/** Etapa del embudo conversacional (docs §12.1). */
export const conversationStageSchema = z.enum([
  "NEW",
  "DISCOVERY",
  "SEARCHING",
  "PRESENTING",
  "SCHEDULING",
  "CLOSED",
]);
export type ConversationStageContract = z.infer<typeof conversationStageSchema>;

export const messageAuthorSchema = z.enum(["CONTACT", "AGENT", "HUMAN", "SYSTEM"]);
export type MessageAuthorContract = z.infer<typeof messageAuthorSchema>;

export const inboxEntrySchema = z.object({
  conversationId: idSchema,
  contactId: idSchema,
  contactName: z.string(),
  channelType: channelTypeSchema,
  status: conversationStatusSchema,
  stage: conversationStageSchema,
  assignedUserId: idSchema.optional(),
  lastMessagePreview: z.string(),
  lastMessageAt: isoDateTimeSchema,
  lastMessageFrom: messageAuthorSchema,
  messageCount: z.number().int(),
});
export type InboxEntryContract = z.infer<typeof inboxEntrySchema>;

export const inboxListResponseSchema = z.object({
  items: z.array(inboxEntrySchema),
  total: z.number().int(),
});
export type InboxListResponse = z.infer<typeof inboxListResponseSchema>;

export const inboxListQuerySchema = z.object({
  status: conversationStatusSchema.optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InboxListQuery = z.infer<typeof inboxListQuerySchema>;

export const conversationMessageSchema = z.object({
  id: idSchema,
  author: messageAuthorSchema,
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  blocks: z.array(replyBlockSchema),
  sentAt: isoDateTimeSchema,
});
export type ConversationMessageContract = z.infer<typeof conversationMessageSchema>;

/** Un dato recordado del cliente, con de dónde salió. */
export const profileSlotSchema = z.object({
  name: z.string(),
  value: z.string(),
  source: z.string(),
  confidence: z.number(),
});
export type ProfileSlotContract = z.infer<typeof profileSlotSchema>;

export const conversationDetailSchema = z.object({
  conversationId: idSchema,
  contactId: idSchema,
  contactName: z.string(),
  channelType: channelTypeSchema,
  status: conversationStatusSchema,
  stage: conversationStageSchema,
  assignedUserId: idSchema.optional(),
  messages: z.array(conversationMessageSchema),
  /** Memoria del cliente, para que el asesor no tenga que releer el hilo. */
  profile: z.array(profileSlotSchema),
  missingRequiredSlots: z.array(z.string()),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const sendMessageRequestSchema = z.object({
  text: z.string().min(1).max(4000),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const takeoverRequestSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type TakeoverRequest = z.infer<typeof takeoverRequestSchema>;

/** Eventos que el inbox recibe en vivo por SSE. */
export const inboxEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    conversationId: idSchema,
    author: messageAuthorSchema,
    preview: z.string(),
    sentAt: isoDateTimeSchema,
  }),
  z.object({
    type: z.literal("conversation_changed"),
    conversationId: idSchema,
    status: conversationStatusSchema,
  }),
]);
export type InboxEvent = z.infer<typeof inboxEventSchema>;
