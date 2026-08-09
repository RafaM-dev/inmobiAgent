import type { Prisma } from "@prisma/client";
import type { EventEnvelope } from "../events/event";
import type { OutboxRecord, OutboxStore } from "../events/outbox";
import type { Database } from "./prisma";

interface OutboxRow {
  id: string;
  event_id: string;
  type: string;
  version: number;
  tenant_id: string;
  occurred_at: Date;
  correlation_id: string;
  causation_id: string | null;
  payload: unknown;
  attempts: number;
  available_at: Date;
}

/**
 * Cuánto deja de ser visible un evento reservado.
 *
 * Tiene que superar lo que tarda el relay en procesar un lote entero. Si se
 * queda corto, otra réplica lo recoge mientras el primero aún trabaja; si se
 * pasa, un worker muerto retrasa sus eventos ese tiempo. Un minuto cubre con
 * holgura un lote de 50 y mantiene la recuperación rápida.
 */
const VISIBILITY_TIMEOUT_MS = 60_000;

/**
 * Implementación del outbox sobre PostgreSQL.
 *
 * `reserveBatch` combina `FOR UPDATE SKIP LOCKED` —para que dos réplicas que
 * sondean a la vez no se peleen por las mismas filas— con un plazo de
 * invisibilidad, que es lo que de verdad reserva el lote mientras se entrega.
 * Prisma no expone SKIP LOCKED, así que esta consulta es SQL crudo a propósito.
 */
export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly db: Database) {}

  async enqueue(envelope: EventEnvelope): Promise<void> {
    // Se une a la transacción ambiental si el caso de uso abrió una.
    await this.db.client().outboxEvent.create({
      data: {
        eventId: envelope.eventId,
        type: envelope.type,
        version: envelope.version,
        tenantId: envelope.tenantId,
        occurredAt: envelope.occurredAt,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId ?? null,
        payload: envelope.payload as Prisma.InputJsonValue,
      },
    });
  }

  async reserveBatch(limit: number, now: Date): Promise<OutboxRecord[]> {
    /*
     * La reserva EMPUJA `available_at` hacia adelante, no solo incrementa los
     * intentos.
     *
     * `FOR UPDATE SKIP LOCKED` solo sostiene el bloqueo mientras dura la
     * sentencia. En cuanto termina, las filas vuelven a ser visibles — y el
     * relay tarda mucho más que eso: reserva un lote y luego entrega los
     * eventos uno a uno, ejecutando manejadores por medio. Sin este empujón,
     * una segunda réplica que sondeara durante ese rato se llevaría el MISMO
     * lote y lo entregaría otra vez. Lo destapó un test de integración que
     * pedía dos lotes seguidos y recibía los mismos tres eventos.
     *
     * El sistema no llegaba a ejecutar el manejador dos veces —la idempotencia
     * del bus lo impide— pero el trabajo se duplicaba y la promesa de "varias
     * réplicas sin duplicar entregas" no era cierta.
     *
     * Si el worker muere a mitad, los eventos vuelven a estar disponibles
     * pasado el plazo. Es un aplazamiento, nunca una pérdida.
     */
    const visibleAgainAt = new Date(now.getTime() + VISIBILITY_TIMEOUT_MS);

    const rows = await this.db.raw().$queryRaw<OutboxRow[]>`
      WITH reserved AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'PENDING' AND available_at <= ${now}
        ORDER BY available_at ASC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events o
      SET attempts = o.attempts + 1,
          available_at = ${visibleAgainAt}
      FROM reserved r
      WHERE o.id = r.id
      RETURNING o.id, o.event_id, o.type, o.version, o.tenant_id, o.occurred_at,
                o.correlation_id, o.causation_id, o.payload, o.attempts, o.available_at
    `;

    return rows.map((row) => ({
      id: row.id,
      attempts: row.attempts - 1, // `attempts` ya incluye este intento.
      availableAt: row.available_at,
      envelope: {
        eventId: row.event_id,
        type: row.type,
        version: row.version,
        tenantId: row.tenant_id,
        occurredAt: row.occurred_at,
        correlationId: row.correlation_id,
        ...(row.causation_id ? { causationId: row.causation_id } : {}),
        payload: row.payload,
      },
    }));
  }

  async markPublished(ids: readonly string[], publishedAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.raw().outboxEvent.updateMany({
      where: { id: { in: [...ids] } },
      data: { status: "PUBLISHED", publishedAt, lastError: null },
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.db.raw().outboxEvent.update({
      where: { id },
      data: { availableAt: nextAttemptAt, lastError: error.slice(0, 2000) },
    });
  }

  async markDeadLettered(id: string, error: string): Promise<void> {
    await this.db.raw().outboxEvent.update({
      where: { id },
      data: { status: "DEAD_LETTERED", lastError: error.slice(0, 2000) },
    });
  }
}
