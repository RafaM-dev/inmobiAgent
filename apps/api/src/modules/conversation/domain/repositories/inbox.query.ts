import type { ChannelType } from "../../../channels";
import type { ConversationStage, ConversationStatus } from "../entities/conversation";

/**
 * PUERTO DE LECTURA de la bandeja.
 *
 * Va aparte de `ConversationRepository` a propósito: aquél carga agregados para
 * cambiarlos, y esto responde una pregunta de pantalla. Mezclarlos acaba en un
 * repositorio que devuelve a veces entidades y a veces filas planas, y en
 * consultas que cargan una conversación entera para pintar una línea de lista.
 *
 * La bandeja de un asesor con mil conversaciones se pinta con una consulta, no
 * con mil hidrataciones de agregado.
 */

export interface InboxFilter {
  readonly status?: ConversationStatus;
  /** Solo las asignadas a este asesor. Para "mis conversaciones". */
  readonly assignedUserId?: string;
  readonly limit: number;
  readonly offset?: number;
}

export interface InboxEntry {
  readonly conversationId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly channelType: ChannelType;
  readonly status: ConversationStatus;
  readonly stage: ConversationStage;
  readonly assignedUserId?: string;
  /** Primeros caracteres del último mensaje. Ya proyectado a texto. */
  readonly lastMessagePreview: string;
  readonly lastMessageAt: Date;
  readonly lastMessageFrom: string;
  readonly messageCount: number;
  readonly lastActivityAt: Date;
}

export interface InboxQuery {
  list(filter: InboxFilter): Promise<readonly InboxEntry[]>;
  count(filter: Omit<InboxFilter, "limit" | "offset">): Promise<number>;
}
