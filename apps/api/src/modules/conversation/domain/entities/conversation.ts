import { DomainError } from "../../../../platform/errors/app-error";
import type { ChannelType } from "../../../channels";

/**
 * Estado operativo: quién está al mando de la conversación.
 * Es ortogonal a la etapa comercial (`ConversationStage`).
 */
export const ConversationStatus = {
  OPEN: "OPEN",
  /** El bot está en silencio pero nadie lo ha tomado aún. */
  BOT_PAUSED: "BOT_PAUSED",
  /** Un asesor humano está respondiendo. El bot no envía nada (docs §12.1). */
  HUMAN: "HUMAN",
  CLOSED: "CLOSED",
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

/** Etapa del embudo comercial (docs §12.1). */
export const ConversationStage = {
  NEW: "NEW",
  DISCOVERY: "DISCOVERY",
  SEARCHING: "SEARCHING",
  PRESENTING: "PRESENTING",
  SCHEDULING: "SCHEDULING",
  CLOSED: "CLOSED",
} as const;
export type ConversationStage = (typeof ConversationStage)[keyof typeof ConversationStage];

export interface ConversationProps {
  readonly id: string;
  readonly tenantId: string;
  readonly contactId: string;
  readonly channelAccountId: string;
  readonly channelType: ChannelType;
  /** Identidad del cliente en el proveedor: a dónde se responde. */
  readonly externalContactId: string;
  readonly status: ConversationStatus;
  readonly stage: ConversationStage;
  readonly assignedUserId: string | undefined;
  readonly lastActivityAt: Date;
  readonly closedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Conversación: el agregado raíz del módulo.
 *
 * Guarda una invariante que suena obvia y que sin un agregado se incumple
 * tarde o temprano: **no se añaden mensajes a una conversación cerrada**. Y una
 * regla de producto igual de importante: mientras un humano está al mando, el
 * bot no habla. Ambas viven aquí, no en el caso de uso, porque valen para
 * cualquier canal y para cualquier origen del mensaje.
 */
export class Conversation {
  private constructor(private props: ConversationProps) {}

  static start(input: {
    id: string;
    tenantId: string;
    contactId: string;
    channelAccountId: string;
    channelType: ChannelType;
    externalContactId: string;
    now: Date;
  }): Conversation {
    return new Conversation({
      id: input.id,
      tenantId: input.tenantId,
      contactId: input.contactId,
      channelAccountId: input.channelAccountId,
      channelType: input.channelType,
      externalContactId: input.externalContactId,
      status: ConversationStatus.OPEN,
      stage: ConversationStage.NEW,
      assignedUserId: undefined,
      lastActivityAt: input.now,
      closedAt: undefined,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: ConversationProps): Conversation {
    return new Conversation(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get contactId(): string {
    return this.props.contactId;
  }
  get channelAccountId(): string {
    return this.props.channelAccountId;
  }
  get channelType(): ChannelType {
    return this.props.channelType;
  }
  get externalContactId(): string {
    return this.props.externalContactId;
  }
  get status(): ConversationStatus {
    return this.props.status;
  }
  get stage(): ConversationStage {
    return this.props.stage;
  }
  get assignedUserId(): string | undefined {
    return this.props.assignedUserId;
  }
  get lastActivityAt(): Date {
    return this.props.lastActivityAt;
  }
  get isClosed(): boolean {
    return this.props.status === ConversationStatus.CLOSED;
  }
  /** ¿Puede el agente automático responder ahora mismo? */
  get isBotActive(): boolean {
    return this.props.status === ConversationStatus.OPEN;
  }

  /** Llega un mensaje del cliente. */
  registerInbound(now: Date): void {
    if (this.isClosed) {
      throw new DomainError("No se pueden añadir mensajes a una conversación cerrada", {
        conversationId: this.props.id,
      });
    }
    const stage =
      this.props.stage === ConversationStage.NEW ? ConversationStage.DISCOVERY : this.props.stage;
    this.props = { ...this.props, stage, lastActivityAt: now, updatedAt: now };
  }

  /** Sale un mensaje nuestro (del agente o de un asesor). */
  registerOutbound(now: Date): void {
    if (this.isClosed) {
      throw new DomainError("No se pueden añadir mensajes a una conversación cerrada", {
        conversationId: this.props.id,
      });
    }
    this.props = { ...this.props, lastActivityAt: now, updatedAt: now };
  }

  advanceStage(stage: ConversationStage, now: Date): void {
    if (this.isClosed) return;
    this.props = { ...this.props, stage, updatedAt: now };
  }

  pauseBot(now: Date): void {
    if (this.isClosed) return;
    this.props = { ...this.props, status: ConversationStatus.BOT_PAUSED, updatedAt: now };
  }

  /** Un asesor toma el control: a partir de aquí el bot calla (docs §12.1). */
  assignToHuman(userId: string, now: Date): void {
    if (this.isClosed) {
      throw new DomainError("No se puede asignar una conversación cerrada");
    }
    this.props = {
      ...this.props,
      status: ConversationStatus.HUMAN,
      assignedUserId: userId,
      updatedAt: now,
    };
  }

  returnToBot(now: Date): void {
    if (this.isClosed) {
      throw new DomainError("No se puede devolver al bot una conversación cerrada");
    }
    this.props = {
      ...this.props,
      status: ConversationStatus.OPEN,
      assignedUserId: undefined,
      updatedAt: now,
    };
  }

  close(now: Date): void {
    if (this.isClosed) return;
    this.props = {
      ...this.props,
      status: ConversationStatus.CLOSED,
      stage: ConversationStage.CLOSED,
      closedAt: now,
      updatedAt: now,
    };
  }

  /** Reabre una conversación cerrada cuando el cliente vuelve a escribir. */
  reopen(now: Date): void {
    if (!this.isClosed) return;
    this.props = {
      ...this.props,
      status: ConversationStatus.OPEN,
      stage: ConversationStage.DISCOVERY,
      closedAt: undefined,
      lastActivityAt: now,
      updatedAt: now,
    };
  }

  snapshot(): ConversationProps {
    return { ...this.props };
  }
}
