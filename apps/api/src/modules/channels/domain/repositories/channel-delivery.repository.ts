import type { DeliveryStatus } from "../value-objects/delivery-status";

export interface RecordDeliveryInput {
  readonly channelAccountId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly providerMessageIds: readonly string[];
  readonly sentAt: Date;
}

export interface DeliveryRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly channelAccountId: string;
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
}

export interface ChannelDeliveryRepository {
  /** Registra los ids del proveedor de un envío. Idempotente por cada uno. */
  recordSent(input: RecordDeliveryInput): Promise<void>;
  /**
   * Aplica un acuse. Devuelve el registro afectado, o `null` si el id no es
   * nuestro: un webhook puede traer acuses de mensajes enviados por otra
   * herramienta sobre el mismo número.
   */
  applyStatus(input: {
    providerMessageId: string;
    status: DeliveryStatus;
    occurredAt: Date;
    reason?: string;
  }): Promise<DeliveryRecord | null>;
}
