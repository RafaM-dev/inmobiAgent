import { DomainError } from "../../../../platform/errors/app-error";
import { blocksToText, type InboundContent, type ReplyBlock } from "../../../channels";

export const MessageDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageAuthorType = {
  /** El cliente final. */
  CONTACT: "CONTACT",
  /** El agente de IA. */
  AGENT: "AGENT",
  /** Un asesor humano desde el back-office. */
  HUMAN: "HUMAN",
  /** Avisos del sistema (escalamiento, cierre por inactividad). */
  SYSTEM: "SYSTEM",
} as const;
export type MessageAuthorType = (typeof MessageAuthorType)[keyof typeof MessageAuthorType];

export const MessageStatus = {
  RECEIVED: "RECEIVED",
  PENDING: "PENDING",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/**
 * Contenido de un mensaje.
 *
 * Reutiliza los contratos de `channels` en vez de inventar un tercer formato:
 * lo que entra es `InboundContent`, lo que sale es `ReplyBlock`, y ambos son ya
 * agnósticos de proveedor. Un formato propio solo añadiría dos traducciones más
 * sin ganar nada.
 */
export type MessageBlock = InboundContent | ReplyBlock;

export interface MessageProps {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly direction: MessageDirection;
  readonly authorType: MessageAuthorType;
  readonly authorId: string | undefined;
  readonly blocks: readonly MessageBlock[];
  /** Id del mensaje en el proveedor. Clave de idempotencia de entrada. */
  readonly externalMessageId: string | undefined;
  /** Id que devolvió el proveedor al enviar. Sirve para acuses de entrega. */
  readonly providerMessageId: string | undefined;
  readonly status: MessageStatus;
  /**
   * Turno que consumió este mensaje. `undefined` = pendiente de procesar.
   * Vive en la fila y no en memoria para que un reinicio no pierda el turno.
   */
  readonly turnId: string | undefined;
  readonly sentAt: Date;
  readonly failureReason: string | undefined;
}

/**
 * Mensaje: hecho consumado dentro de una conversación.
 *
 * Casi inmutable: solo cambian su estado de entrega y el turno que lo consumió.
 * El texto de lo que se dijo no se reescribe nunca — es el registro de lo que
 * el cliente vio.
 */
export class Message {
  private constructor(private props: MessageProps) {}

  static inbound(input: {
    id: string;
    tenantId: string;
    conversationId: string;
    blocks: readonly MessageBlock[];
    externalMessageId: string;
    receivedAt: Date;
  }): Message {
    if (input.blocks.length === 0) {
      throw new DomainError("Un mensaje entrante no puede venir vacío");
    }
    return new Message({
      id: input.id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: MessageDirection.INBOUND,
      authorType: MessageAuthorType.CONTACT,
      authorId: undefined,
      blocks: input.blocks,
      externalMessageId: input.externalMessageId,
      providerMessageId: undefined,
      status: MessageStatus.RECEIVED,
      turnId: undefined,
      sentAt: input.receivedAt,
      failureReason: undefined,
    });
  }

  static outbound(input: {
    id: string;
    tenantId: string;
    conversationId: string;
    authorType: MessageAuthorType;
    authorId?: string | undefined;
    blocks: readonly MessageBlock[];
    now: Date;
  }): Message {
    if (input.blocks.length === 0) {
      throw new DomainError("No se puede enviar un mensaje sin contenido");
    }
    return new Message({
      id: input.id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: MessageDirection.OUTBOUND,
      authorType: input.authorType,
      authorId: input.authorId,
      blocks: input.blocks,
      externalMessageId: undefined,
      providerMessageId: undefined,
      // Se persiste como PENDING ANTES de intentar el envío: si el proveedor
      // falla, queda constancia de lo que se intentó decir.
      status: MessageStatus.PENDING,
      turnId: undefined,
      sentAt: input.now,
      failureReason: undefined,
    });
  }

  static rehydrate(props: MessageProps): Message {
    return new Message(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get conversationId(): string {
    return this.props.conversationId;
  }
  get direction(): MessageDirection {
    return this.props.direction;
  }
  get authorType(): MessageAuthorType {
    return this.props.authorType;
  }
  get blocks(): readonly MessageBlock[] {
    return this.props.blocks;
  }
  get status(): MessageStatus {
    return this.props.status;
  }
  get turnId(): string | undefined {
    return this.props.turnId;
  }
  get sentAt(): Date {
    return this.props.sentAt;
  }
  get externalMessageId(): string | undefined {
    return this.props.externalMessageId;
  }

  /** Texto plano del mensaje, para la ventana de contexto y el back-office. */
  /** Lo que se dijo, en texto plano. La proyección la define `channels`. */
  get text(): string {
    return blocksToText(this.props.blocks);
  }

  markSent(providerMessageId: string | undefined): void {
    this.props = {
      ...this.props,
      status: MessageStatus.SENT,
      providerMessageId,
      failureReason: undefined,
    };
  }

  markFailed(reason: string): void {
    this.props = { ...this.props, status: MessageStatus.FAILED, failureReason: reason };
  }

  /** Lo reclama un turno. Un mensaje solo puede pertenecer a un turno. */
  assignToTurn(turnId: string): void {
    if (this.props.turnId !== undefined && this.props.turnId !== turnId) {
      throw new DomainError("El mensaje ya fue consumido por otro turno", {
        messageId: this.props.id,
        turnId: this.props.turnId,
      });
    }
    this.props = { ...this.props, turnId };
  }

  snapshot(): MessageProps {
    return { ...this.props };
  }
}
