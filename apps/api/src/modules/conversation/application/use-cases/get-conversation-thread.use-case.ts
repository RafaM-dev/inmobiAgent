import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import { assertSameTenant } from "../../../../platform/tenancy/tenant-context";
import type { ChannelType, ReplyBlock } from "../../../channels";
import type { ProfileSlots } from "../../domain/entities/contact-profile";
import type { ConversationStage, ConversationStatus } from "../../domain/entities/conversation";
import type { MessageAuthorType, MessageDirection } from "../../domain/entities/message";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationRepository,
  MessageRepository,
} from "../../domain/repositories/conversation.repositories";

/** Mensajes que se cargan de golpe. Un hilo más largo se pagina (F10). */
const THREAD_SIZE = 200;

export interface ThreadMessage {
  readonly id: string;
  readonly author: MessageAuthorType;
  readonly direction: MessageDirection;
  readonly blocks: readonly ReplyBlock[];
  readonly sentAt: Date;
}

export interface ThreadProfileSlot {
  readonly name: string;
  readonly value: string;
  readonly source: string;
  readonly confidence: number;
}

export interface ConversationThread {
  readonly conversationId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly channelType: ChannelType;
  readonly status: ConversationStatus;
  readonly stage: ConversationStage;
  readonly assignedUserId?: string;
  readonly messages: readonly ThreadMessage[];
  readonly profile: readonly ThreadProfileSlot[];
  readonly missingRequiredSlots: readonly string[];
}

/**
 * El hilo completo para el back-office.
 *
 * Devuelve BLOQUES, no texto plano: el asesor tiene que ver exactamente lo que
 * vio el cliente —las fichas con sus precios, los botones que se le
 * ofrecieron—. Aplanarlo a texto aquí obligaría a que la web adivinara qué era
 * cada cosa, y perdería justo la información que hace falta para entender por
 * qué el cliente respondió lo que respondió.
 *
 * Incluye además la memoria del cliente con su procedencia, para que el asesor
 * que toma una conversación a la mitad no tenga que releerla entera.
 */
export class GetConversationThreadUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationRepository;
      contacts: ContactRepository;
      messages: MessageRepository;
      profiles: ContactProfileRepository;
    },
  ) {}

  async execute(conversationId: string): Promise<Result<ConversationThread, AppError>> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!conversation) return err(new NotFoundError("Conversación", conversationId));
    assertSameTenant(conversation.tenantId, "conversación");

    const [contact, messages, profile] = await Promise.all([
      this.deps.contacts.findById(conversation.contactId),
      this.deps.messages.listRecent(conversationId, THREAD_SIZE),
      this.deps.profiles.find(conversation.contactId),
    ]);

    return ok({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      contactName: contact?.displayName ?? "Cliente",
      channelType: conversation.channelType,
      status: conversation.status,
      stage: conversation.stage,
      ...(conversation.assignedUserId !== undefined
        ? { assignedUserId: conversation.assignedUserId }
        : {}),
      messages: messages.map((message) => ({
        id: message.id,
        author: message.authorType,
        direction: message.direction,
        // Los bloques de entrada y de salida comparten forma: `channels` los
        // definió así en F1 justo para que esto no necesitara traducción.
        blocks: message.blocks as readonly ReplyBlock[],
        sentAt: message.sentAt,
      })),
      profile: toProfileSlots(profile?.slots ?? {}),
      missingRequiredSlots: profile?.missingRequiredSlots() ?? [],
    });
  }
}

/** Perfil → filas legibles. La procedencia viaja: no es lo mismo dicho que deducido. */
const toProfileSlots = (slots: Readonly<ProfileSlots>): ThreadProfileSlot[] => {
  const rows: ThreadProfileSlot[] = [];

  // `exactOptionalPropertyTypes` garantiza que un slot presente tiene valor:
  // no existe la posibilidad de una clave con `undefined` explícito.
  for (const [name, slot] of Object.entries(slots)) {
    rows.push({
      name,
      value: formatValue(slot.value),
      source: slot.source,
      confidence: slot.confidence,
    });
  }

  return rows;
};

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(", ");
  if (value !== null && typeof value === "object") {
    const range = value as { min?: number; max?: number; currency?: string };
    if (range.currency) {
      const major = (amount: number): string => (amount / 100).toLocaleString("es-CO");
      if (range.min !== undefined && range.max !== undefined) {
        return `entre ${major(range.min)} y ${major(range.max)} ${range.currency}`;
      }
      if (range.max !== undefined) return `hasta ${major(range.max)} ${range.currency}`;
      if (range.min !== undefined) return `desde ${major(range.min)} ${range.currency}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
};
