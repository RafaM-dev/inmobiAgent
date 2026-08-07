import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import { assertSameTenant } from "../../../../platform/tenancy/tenant-context";
import type { ChannelType } from "../../../channels";
import type { ProfileSlotName, ProfileSlots } from "../../domain/entities/contact-profile";
import type { ConversationStage, ConversationStatus } from "../../domain/entities/conversation";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationRepository,
  MessageRepository,
} from "../../domain/repositories/conversation.repositories";

export interface ContextMessage {
  readonly role: "contact" | "assistant" | "human" | "system";
  readonly text: string;
  readonly sentAt: Date;
}

export interface ConversationContext {
  readonly conversationId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly externalContactId: string;
  readonly status: ConversationStatus;
  readonly stage: ConversationStage;
  /** Ventana de mensajes recientes, del más antiguo al más reciente. */
  readonly messages: readonly ContextMessage[];
  readonly profile: Readonly<ProfileSlots>;
  readonly missingRequiredSlots: readonly ProfileSlotName[];
}

const ROLE_BY_AUTHOR: Record<string, ContextMessage["role"]> = {
  CONTACT: "contact",
  AGENT: "assistant",
  HUMAN: "human",
  SYSTEM: "system",
};

/**
 * Contexto de la conversación para quien tenga que razonar sobre ella.
 *
 * Devuelve datos, no un prompt. La diferencia importa: el `ContextBuilder` del
 * agente (F2) decidirá cuánto cabe y en qué orden según el presupuesto de
 * tokens, pero ese es problema suyo. Aquí no hay ni una decisión de IA, y por
 * eso este caso de uso sirve igual al back-office que al agente.
 */
export class GetConversationContextUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      contacts: ContactRepository;
      messages: MessageRepository;
      profiles: ContactProfileRepository;
      windowSize?: number;
    },
  ) {}

  async execute(conversationId: string): Promise<Result<ConversationContext, AppError>> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!conversation) return err(new NotFoundError("Conversación", conversationId));
    assertSameTenant(conversation.tenantId, "conversación");

    const [contact, messages, profile] = await Promise.all([
      this.deps.contacts.findById(conversation.contactId),
      this.deps.messages.listRecent(conversationId, this.deps.windowSize ?? 20),
      this.deps.profiles.find(conversation.contactId),
    ]);

    return ok({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      contactName: contact?.displayName ?? "Cliente",
      channelType: conversation.channelType,
      channelAccountId: conversation.channelAccountId,
      externalContactId: conversation.externalContactId,
      status: conversation.status,
      stage: conversation.stage,
      messages: messages.map((message) => ({
        role: ROLE_BY_AUTHOR[message.authorType] ?? "system",
        text: message.text,
        sentAt: message.sentAt,
      })),
      profile: profile?.slots ?? {},
      missingRequiredSlots: profile?.missingRequiredSlots() ?? [],
    });
  }
}
