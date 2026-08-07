import type {
  Contact as PrismaContact,
  ContactProfile as PrismaContactProfile,
  Conversation as PrismaConversation,
  Message as PrismaMessage,
} from "../../../../../generated/prisma/client";
import { Contact } from "../../../domain/entities/contact";
import { ContactProfile, type ProfileSlots } from "../../../domain/entities/contact-profile";
import { Conversation } from "../../../domain/entities/conversation";
import { Message, type MessageBlock } from "../../../domain/entities/message";
import type { ProfileSlot } from "../../../domain/value-objects/profile-slot";

/**
 * Traducción fila ⇄ dominio.
 *
 * Las fechas dentro de JSON son el punto delicado: Postgres devuelve cadenas y
 * el dominio trabaja con `Date`. Se rehidratan aquí, una sola vez, en lugar de
 * dejar `string | Date` corriendo por todo el módulo.
 */

export const contactToDomain = (row: PrismaContact): Contact =>
  Contact.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    primaryPhone: row.primaryPhone ?? undefined,
    email: row.email ?? undefined,
    locale: row.locale,
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export const conversationToDomain = (row: PrismaConversation): Conversation =>
  Conversation.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    contactId: row.contactId,
    channelAccountId: row.channelAccountId,
    channelType: row.channelType,
    externalContactId: row.externalContactId,
    status: row.status,
    stage: row.stage,
    assignedUserId: row.assignedUserId ?? undefined,
    lastActivityAt: row.lastActivityAt,
    closedAt: row.closedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export const messageToDomain = (row: PrismaMessage): Message =>
  Message.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    direction: row.direction,
    authorType: row.authorType,
    authorId: row.authorId ?? undefined,
    blocks: (row.blocks ?? []) as MessageBlock[],
    externalMessageId: row.externalMessageId ?? undefined,
    providerMessageId: row.providerMessageId ?? undefined,
    status: row.status,
    turnId: row.turnId ?? undefined,
    sentAt: row.sentAt,
    failureReason: row.failureReason ?? undefined,
  });

/** Rehidrata las marcas de tiempo de cada slot, que en JSON viajan como texto. */
const slotsToDomain = (raw: unknown): ProfileSlots => {
  if (raw === null || typeof raw !== "object") return {};

  const out: Record<string, ProfileSlot<unknown>> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const candidate = value as { value: unknown; confidence: number; source: string; updatedAt: string };
    out[name] = {
      value: candidate.value,
      confidence: candidate.confidence,
      source: candidate.source as ProfileSlot<unknown>["source"],
      updatedAt: new Date(candidate.updatedAt),
    };
  }
  return out;
};

export const profileToDomain = (row: PrismaContactProfile): ContactProfile =>
  ContactProfile.rehydrate({
    tenantId: row.tenantId,
    contactId: row.contactId,
    slots: slotsToDomain(row.slots),
    freeNotes: row.freeNotes,
    updatedAt: row.updatedAt,
  });
