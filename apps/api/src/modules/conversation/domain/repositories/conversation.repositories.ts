import type { ChannelType } from "../../../channels";
import type { Contact } from "../entities/contact";
import type { ContactProfile, ProfileChange } from "../entities/contact-profile";
import type { Conversation } from "../entities/conversation";
import type { Message } from "../entities/message";

/**
 * Puertos de persistencia del módulo.
 *
 * Van juntos en un archivo porque forman una sola unidad de diseño: son las
 * cuatro piezas que un turno toca en la misma transacción. Separarlos en cuatro
 * archivos de seis líneas no aclararía nada.
 *
 * Ninguno recibe `tenantId`: lo pone el `tenantScope()` de la implementación.
 */

export interface ContactRepository {
  findById(id: string): Promise<Contact | null>;
  /** Resolución por identidad de canal: (canal, id externo) → contacto. */
  findByChannelIdentity(channelType: ChannelType, externalId: string): Promise<Contact | null>;
  save(contact: Contact): Promise<void>;
  /** Vincula una identidad de canal a un contacto. Idempotente. */
  linkIdentity(input: {
    contactId: string;
    channelType: ChannelType;
    externalId: string;
    displayName?: string | undefined;
  }): Promise<void>;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  /** Conversación viva del contacto en esa cuenta de canal, si la hay. */
  findOpenByContact(contactId: string, channelAccountId: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  /** Conversaciones sin actividad desde `threshold`, para el job de seguimiento. */
  listIdle(threshold: Date, limit: number): Promise<Conversation[]>;
}

export interface MessageRepository {
  findById(id: string): Promise<Message | null>;
  /** `null` si el proveedor ya había entregado ese mensaje (idempotencia). */
  findByExternalId(externalMessageId: string): Promise<Message | null>;
  save(message: Message): Promise<void>;
  /** Últimos `limit` mensajes, del más antiguo al más reciente. */
  listRecent(conversationId: string, limit: number): Promise<Message[]>;
  /** Mensajes entrantes que ningún turno ha consumido todavía. */
  listPendingTurnMessages(conversationId: string): Promise<Message[]>;
  /** Marca en bloque los mensajes de un turno. Devuelve cuántos reclamó. */
  assignTurn(messageIds: readonly string[], turnId: string): Promise<number>;
}

export interface ContactProfileRepository {
  find(contactId: string): Promise<ContactProfile | null>;
  /** Guarda el perfil y registra los cambios en el histórico append-only. */
  save(profile: ContactProfile, changes: readonly ProfileChange[]): Promise<void>;
}

/**
 * Exclusión mutua por conversación (docs §7.2).
 *
 * Sin esto, dos réplicas pueden ejecutar el turno de la misma conversación a la
 * vez y el cliente recibe dos respuestas distintas a la misma pregunta.
 * `withLock` devuelve `null` si otro proceso lo tiene tomado: no es un error,
 * es "ya se está ocupando alguien".
 */
export interface ConversationLock {
  withLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T | null>;
}
