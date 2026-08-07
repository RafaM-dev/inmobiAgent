import { TenantContext } from "../../../platform/tenancy/tenant-context";
import type { ChannelType } from "../../channels";
import type { Contact } from "../domain/entities/contact";
import type { ContactProfile, ProfileChange } from "../domain/entities/contact-profile";
import { ConversationStatus, type Conversation } from "../domain/entities/conversation";
import type { Message } from "../domain/entities/message";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationLock,
  ConversationRepository,
  MessageRepository,
} from "../domain/repositories/conversation.repositories";
import type { ScheduleTurnCommand, TurnScheduler } from "../application/ports/turn-scheduler";

/**
 * Dobles en memoria del módulo.
 *
 * Permiten probar los casos de uso —idempotencia, agrupación de turnos, la
 * regla de "el bot calla si hay un humano"— sin Postgres y en milisegundos.
 * Los repositorios Prisma se prueban aparte, contra una base real.
 */

export class InMemoryContactRepository implements ContactRepository {
  readonly items = new Map<string, Contact>();
  readonly identities = new Map<string, string>();

  /**
   * La clave incluye el tenant igual que el índice real: un doble que no
   * modela el aislamiento esconde precisamente los fallos que buscamos.
   */
  private key(channelType: ChannelType, externalId: string): string {
    return `${TenantContext.requireTenantId()}:${channelType}:${externalId}`;
  }

  findById(id: string): Promise<Contact | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByChannelIdentity(channelType: ChannelType, externalId: string): Promise<Contact | null> {
    const contactId = this.identities.get(this.key(channelType, externalId));
    return Promise.resolve(contactId ? (this.items.get(contactId) ?? null) : null);
  }

  save(contact: Contact): Promise<void> {
    this.items.set(contact.id, contact);
    return Promise.resolve();
  }

  linkIdentity(input: {
    contactId: string;
    channelType: ChannelType;
    externalId: string;
  }): Promise<void> {
    this.identities.set(this.key(input.channelType, input.externalId), input.contactId);
    return Promise.resolve();
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  readonly items = new Map<string, Conversation>();

  findById(id: string): Promise<Conversation | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findOpenByContact(contactId: string, channelAccountId: string): Promise<Conversation | null> {
    for (const conversation of this.items.values()) {
      if (
        conversation.contactId === contactId &&
        conversation.channelAccountId === channelAccountId &&
        conversation.status !== ConversationStatus.CLOSED
      ) {
        return Promise.resolve(conversation);
      }
    }
    return Promise.resolve(null);
  }

  save(conversation: Conversation): Promise<void> {
    this.items.set(conversation.id, conversation);
    return Promise.resolve();
  }

  listIdle(threshold: Date, limit: number): Promise<Conversation[]> {
    return Promise.resolve(
      [...this.items.values()]
        .filter((c) => c.status === ConversationStatus.OPEN && c.lastActivityAt < threshold)
        .slice(0, limit),
    );
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  readonly items = new Map<string, Message>();

  findById(id: string): Promise<Message | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByExternalId(externalMessageId: string): Promise<Message | null> {
    for (const message of this.items.values()) {
      if (message.externalMessageId === externalMessageId) return Promise.resolve(message);
    }
    return Promise.resolve(null);
  }

  save(message: Message): Promise<void> {
    this.items.set(message.id, message);
    return Promise.resolve();
  }

  listRecent(conversationId: string, limit: number): Promise<Message[]> {
    const all = [...this.items.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    return Promise.resolve(all.slice(-limit));
  }

  listPendingTurnMessages(conversationId: string): Promise<Message[]> {
    return Promise.resolve(
      [...this.items.values()]
        .filter(
          (m) =>
            m.conversationId === conversationId &&
            m.direction === "INBOUND" &&
            m.turnId === undefined,
        )
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
    );
  }

  assignTurn(messageIds: readonly string[], turnId: string): Promise<number> {
    let count = 0;
    for (const id of messageIds) {
      const message = this.items.get(id);
      if (message && message.turnId === undefined) {
        message.assignToTurn(turnId);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

export class InMemoryContactProfileRepository implements ContactProfileRepository {
  readonly items = new Map<string, ContactProfile>();
  readonly facts: ProfileChange[] = [];

  find(contactId: string): Promise<ContactProfile | null> {
    return Promise.resolve(this.items.get(contactId) ?? null);
  }

  save(profile: ContactProfile, changes: readonly ProfileChange[]): Promise<void> {
    this.items.set(profile.contactId, profile);
    this.facts.push(...changes);
    return Promise.resolve();
  }
}

/** Candado que siempre concede. La exclusión real se prueba contra Postgres. */
export class NoopConversationLock implements ConversationLock {
  async withLock<T>(_conversationId: string, fn: () => Promise<T>): Promise<T | null> {
    return fn();
  }
}

/** Candado siempre ocupado: simula que otra réplica está atendiendo el turno. */
export class BusyConversationLock implements ConversationLock {
  withLock<T>(): Promise<T | null> {
    return Promise.resolve(null);
  }
}

/** Planificador que solo anota. Evita temporizadores en los tests de casos de uso. */
export class RecordingTurnScheduler implements TurnScheduler {
  readonly scheduled: ScheduleTurnCommand[] = [];
  readonly cancelled: string[] = [];

  schedule(command: ScheduleTurnCommand): void {
    this.scheduled.push(command);
  }
  cancel(conversationId: string): void {
    this.cancelled.push(conversationId);
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  flushAll(): Promise<void> {
    return Promise.resolve();
  }
}
