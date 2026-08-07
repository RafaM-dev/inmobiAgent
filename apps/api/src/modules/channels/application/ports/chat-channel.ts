import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { ChannelCapabilities } from "../../domain/value-objects/channel-capabilities";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import type { InboundMessage } from "../../domain/value-objects/inbound-message";
import type { ReplyBlock } from "../../domain/value-objects/reply-block";

/** Proyección de lectura de una cuenta de canal para los adaptadores. */
export interface ChannelAccountView {
  readonly id: string;
  readonly tenantId: string;
  readonly channelType: ChannelType;
  readonly externalId: string;
  readonly displayName: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface OutboundCommand {
  readonly account: ChannelAccountView;
  /** Destinatario en el proveedor (teléfono, chat id, sesión). */
  readonly toExternalId: string;
  /** Bloques YA degradados a las capacidades del canal. */
  readonly blocks: readonly ReplyBlock[];
  readonly conversationId: string;
  /** Nuestro id de mensaje; permite correlacionar acuses de entrega. */
  readonly messageId: string;
}

export interface DeliveryReceipt {
  readonly providerMessageId?: string;
  /**
   * Todos los ids del proveedor generados por esta respuesta.
   *
   * Una respuesta nuestra puede convertirse en varios mensajes del proveedor
   * —texto, fichas y botones van por separado en WhatsApp—, y cada uno recibe
   * sus propios acuses. Sin la lista completa, los acuses de todos menos el
   * primero llegarían sin poder correlacionarse con nada.
   */
  readonly providerMessageIds?: readonly string[];
  readonly deliveredAt: Date;
}

/**
 * Los acuses llegan DESPUÉS de enviar, por el mismo webhook que los mensajes:
 * `send()` solo puede decir "el proveedor lo aceptó". El vocabulario vive en el
 * dominio porque también lo usan el repositorio y el back-office.
 */
export {
  DeliveryStatus,
  type DeliveryStatusUpdate,
} from "../../domain/value-objects/delivery-status";
import type { DeliveryStatusUpdate } from "../../domain/value-objects/delivery-status";

/**
 * PUERTO `ChatChannel` — el corazón del principio 2.
 *
 * Un canal sabe tres cosas: qué puede hacer, cómo traducir lo que entra y cómo
 * entregar lo que sale. Nada más. No conoce conversaciones, ni leads, ni al
 * agente. Añadir Instagram es implementar esta interfaz y registrarla; ni un
 * solo caso de uso cambia.
 */
export interface ChatChannel {
  readonly type: ChannelType;

  capabilities(account: ChannelAccountView): ChannelCapabilities;

  /**
   * Traduce el payload del proveedor a mensajes canónicos.
   *
   * Devuelve una LISTA porque los webhooks entregan en lote: una sola llamada
   * de WhatsApp puede traer tres mensajes de tres clientes distintos. Un canal
   * de un solo mensaje —la consola— devuelve una lista de uno y no se entera.
   *
   * Devuelve `Result` porque recibir basura de un webhook es un caso esperado,
   * no un fallo del programa. Una lista vacía tampoco es un error: los
   * proveedores mandan notificaciones que no son mensajes.
   */
  normalizeInbound(
    raw: unknown,
    account: ChannelAccountView,
  ): Result<readonly InboundMessage[], AppError>;

  /**
   * Acuses de entrega que venían en el mismo payload. Un canal que no los tenga
   * devuelve una lista vacía.
   */
  normalizeStatuses(raw: unknown, account: ChannelAccountView): readonly DeliveryStatusUpdate[];

  send(command: OutboundCommand): Promise<Result<DeliveryReceipt, AppError>>;
}

/** Catálogo de canales disponibles en esta instalación. */
export interface ChannelRegistry {
  get(type: ChannelType): ChatChannel | undefined;
  require(type: ChannelType): ChatChannel;
  available(): readonly ChannelType[];
}
