import type { Database } from "../../../../../platform/database/prisma";
import { toJson } from "../../../../../platform/database/json";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import type { ChannelType } from "../../../../channels";
import type { Contact } from "../../../domain/entities/contact";
import type { ContactProfile, ProfileChange } from "../../../domain/entities/contact-profile";
import { ConversationStatus, type Conversation } from "../../../domain/entities/conversation";
import type { Message } from "../../../domain/entities/message";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationRepository,
  MessageRepository,
} from "../../../domain/repositories/conversation.repositories";
import {
  contactToDomain,
  conversationToDomain,
  messageToDomain,
  profileToDomain,
} from "./conversation.prisma-mapper";

/**
 * Implementaciones Prisma de los puertos de `conversation`.
 *
 * Van en un archivo porque comparten el mismo cliente, el mismo criterio de
 * ámbito y el mismo mapper: separarlas obligaría a leer cuatro archivos para
 * entender una sola transacción.
 *
 * Toda lectura lleva `tenantScope()`, sin excepción. La única consulta sin
 * ámbito de tenant del sistema es la de identidades de canal, y está aislada en
 * `channels` con su explicación.
 */

export class PrismaContactRepository implements ContactRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async findById(id: string): Promise<Contact | null> {
    const row = await this.db.client().contact.findFirst({ where: { id, ...tenantScope() } });
    return row ? contactToDomain(row) : null;
  }

  async findByChannelIdentity(
    channelType: ChannelType,
    externalId: string,
  ): Promise<Contact | null> {
    const identity = await this.db.client().contactIdentity.findUnique({
      where: {
        tenantId_channelType_externalId: {
          tenantId: tenantScope().tenantId,
          channelType,
          externalId,
        },
      },
      include: { contact: true },
    });
    return identity ? contactToDomain(identity.contact) : null;
  }

  async save(contact: Contact): Promise<void> {
    assertWritableTenant(contact.tenantId, "contacto");
    const data = contact.snapshot();
    await this.db.client().contact.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        displayName: data.displayName,
        primaryPhone: data.primaryPhone ?? null,
        email: data.email ?? null,
        locale: data.locale,
        tags: [...data.tags],
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      update: {
        displayName: data.displayName,
        primaryPhone: data.primaryPhone ?? null,
        email: data.email ?? null,
        locale: data.locale,
        tags: [...data.tags],
      },
    });
  }

  async linkIdentity(input: {
    contactId: string;
    channelType: ChannelType;
    externalId: string;
    displayName?: string | undefined;
  }): Promise<void> {
    const { tenantId } = tenantScope();
    await this.db.client().contactIdentity.upsert({
      where: {
        tenantId_channelType_externalId: {
          tenantId,
          channelType: input.channelType,
          externalId: input.externalId,
        },
      },
      create: {
        id: this.ids.generate(),
        tenantId,
        contactId: input.contactId,
        channelType: input.channelType,
        externalId: input.externalId,
        displayName: input.displayName ?? null,
      },
      update: { displayName: input.displayName ?? null },
    });
  }
}

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Conversation | null> {
    const row = await this.db.client().conversation.findFirst({ where: { id, ...tenantScope() } });
    return row ? conversationToDomain(row) : null;
  }

  async findOpenByContact(
    contactId: string,
    channelAccountId: string,
  ): Promise<Conversation | null> {
    const row = await this.db.client().conversation.findFirst({
      where: {
        ...tenantScope(),
        contactId,
        channelAccountId,
        status: { not: ConversationStatus.CLOSED },
      },
      orderBy: { lastActivityAt: "desc" },
    });
    return row ? conversationToDomain(row) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    assertWritableTenant(conversation.tenantId, "conversación");
    const data = conversation.snapshot();
    await this.db.client().conversation.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        contactId: data.contactId,
        channelAccountId: data.channelAccountId,
        channelType: data.channelType,
        externalContactId: data.externalContactId,
        status: data.status,
        stage: data.stage,
        assignedUserId: data.assignedUserId ?? null,
        lastActivityAt: data.lastActivityAt,
        closedAt: data.closedAt ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      update: {
        status: data.status,
        stage: data.stage,
        assignedUserId: data.assignedUserId ?? null,
        lastActivityAt: data.lastActivityAt,
        closedAt: data.closedAt ?? null,
      },
    });
  }

  async listIdle(threshold: Date, limit: number): Promise<Conversation[]> {
    const rows = await this.db.client().conversation.findMany({
      where: {
        ...tenantScope(),
        status: ConversationStatus.OPEN,
        lastActivityAt: { lt: threshold },
      },
      orderBy: { lastActivityAt: "asc" },
      take: limit,
    });
    return rows.map(conversationToDomain);
  }
}

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Message | null> {
    const row = await this.db.client().message.findFirst({ where: { id, ...tenantScope() } });
    return row ? messageToDomain(row) : null;
  }

  async findByExternalId(externalMessageId: string): Promise<Message | null> {
    const row = await this.db.client().message.findFirst({
      where: { externalMessageId, ...tenantScope() },
    });
    return row ? messageToDomain(row) : null;
  }

  async save(message: Message): Promise<void> {
    assertWritableTenant(message.tenantId, "mensaje");
    const data = message.snapshot();
    await this.db.client().message.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        direction: data.direction,
        authorType: data.authorType,
        authorId: data.authorId ?? null,
        blocks: toJson(data.blocks),
        externalMessageId: data.externalMessageId ?? null,
        providerMessageId: data.providerMessageId ?? null,
        status: data.status,
        turnId: data.turnId ?? null,
        failureReason: data.failureReason ?? null,
        sentAt: data.sentAt,
      },
      // El contenido no se reescribe nunca: solo su estado de entrega.
      update: {
        status: data.status,
        providerMessageId: data.providerMessageId ?? null,
        turnId: data.turnId ?? null,
        failureReason: data.failureReason ?? null,
      },
    });
  }

  async listRecent(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db.client().message.findMany({
      where: { conversationId, ...tenantScope() },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    // Se piden los últimos N y se devuelven en orden cronológico.
    return rows.reverse().map(messageToDomain);
  }

  async listPendingTurnMessages(conversationId: string): Promise<Message[]> {
    const rows = await this.db.client().message.findMany({
      where: {
        conversationId,
        ...tenantScope(),
        direction: "INBOUND",
        turnId: null,
      },
      orderBy: { sentAt: "asc" },
    });
    return rows.map(messageToDomain);
  }

  async assignTurn(messageIds: readonly string[], turnId: string): Promise<number> {
    if (messageIds.length === 0) return 0;
    // `turnId: null` en el filtro hace la operación segura ante concurrencia:
    // si otro proceso ya reclamó los mensajes, esta actualización afecta a 0.
    const result = await this.db.client().message.updateMany({
      where: { id: { in: [...messageIds] }, ...tenantScope(), turnId: null },
      data: { turnId },
    });
    return result.count;
  }
}

export class PrismaContactProfileRepository implements ContactProfileRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async find(contactId: string): Promise<ContactProfile | null> {
    const row = await this.db.client().contactProfile.findFirst({
      where: { contactId, ...tenantScope() },
    });
    return row ? profileToDomain(row) : null;
  }

  async save(profile: ContactProfile, changes: readonly ProfileChange[]): Promise<void> {
    assertWritableTenant(profile.tenantId, "perfil de contacto");
    const data = profile.snapshot();
    const client = this.db.client();

    await client.contactProfile.upsert({
      where: { contactId: data.contactId },
      create: {
        contactId: data.contactId,
        tenantId: data.tenantId,
        slots: toJson(data.slots),
        freeNotes: [...data.freeNotes],
        updatedAt: data.updatedAt,
      },
      update: {
        slots: toJson(data.slots),
        freeNotes: [...data.freeNotes],
        updatedAt: data.updatedAt,
      },
    });

    if (changes.length === 0) return;

    // Histórico append-only: nunca se actualiza ni se borra.
    await client.profileFact.createMany({
      data: changes.map((change) => ({
        id: this.ids.generate(),
        tenantId: data.tenantId,
        contactId: data.contactId,
        slot: change.slot,
        value: toJson(change.value),
        source: change.source,
        confidence: change.confidence,
        recordedAt: change.updatedAt,
      })),
    });
  }
}
