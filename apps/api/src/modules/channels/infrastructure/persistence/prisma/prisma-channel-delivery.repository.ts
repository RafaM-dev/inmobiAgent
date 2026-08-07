import type { Database } from "../../../../../platform/database/prisma";
import { tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import type {
  ChannelDeliveryRepository,
  DeliveryRecord,
  RecordDeliveryInput,
} from "../../../domain/repositories/channel-delivery.repository";
import {
  DELIVERY_RANK,
  DeliveryStatus,
} from "../../../domain/value-objects/delivery-status";

const toStatus = (value: string): DeliveryStatus =>
  value in DeliveryStatus ? (value as DeliveryStatus) : DeliveryStatus.SENT;

export class PrismaChannelDeliveryRepository implements ChannelDeliveryRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async recordSent(input: RecordDeliveryInput): Promise<void> {
    if (input.providerMessageIds.length === 0) return;
    const { tenantId } = tenantScope();

    for (const providerMessageId of input.providerMessageIds) {
      // Idempotente: reintentar un envío que ya se registró no duplica ni
      // pisa el estado que pueda haber llegado ya por webhook.
      await this.db.client().channelDelivery.upsert({
        where: { providerMessageId },
        create: {
          id: this.ids.generate(),
          tenantId,
          channelAccountId: input.channelAccountId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          providerMessageId,
          status: DeliveryStatus.SENT,
          sentAt: input.sentAt,
          updatedAt: input.sentAt,
        },
        update: {},
      });
    }
  }

  /**
   * NO se filtra por tenant al aplicar el acuse, y es deliberado: el webhook
   * llega antes de saber de quién es el mensaje, y `providerMessageId` es único
   * en todo el proveedor. El tenant se DEVUELVE desde la fila, que es la fuente
   * de verdad, en vez de exigirse por adelantado.
   */
  async applyStatus(input: {
    providerMessageId: string;
    status: DeliveryStatus;
    occurredAt: Date;
    reason?: string;
  }): Promise<DeliveryRecord | null> {
    const existing = await this.db.client().channelDelivery.findUnique({
      where: { providerMessageId: input.providerMessageId },
    });
    if (!existing) return null;

    // Los acuses pueden llegar desordenados: un "entregado" que aparece después
    // de un "leído" no puede hacer retroceder el estado.
    const shouldAdvance = DELIVERY_RANK[input.status] > DELIVERY_RANK[toStatus(existing.status)];

    const row = shouldAdvance
      ? await this.db.client().channelDelivery.update({
          where: { providerMessageId: input.providerMessageId },
          data: {
            status: input.status,
            reason: input.reason ?? null,
            updatedAt: input.occurredAt,
          },
        })
      : existing;

    return {
      messageId: row.messageId,
      conversationId: row.conversationId,
      channelAccountId: row.channelAccountId,
      providerMessageId: row.providerMessageId,
      status: toStatus(row.status),
    };
  }
}
