import type { Prisma } from "../../generated/prisma/client";
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
 * Implementación del outbox sobre PostgreSQL.
 *
 * `reserveBatch` usa `FOR UPDATE SKIP LOCKED`: varias réplicas del worker
 * pueden competir por el mismo outbox sin duplicar entregas ni bloquearse.
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
      SET attempts = o.attempts + 1
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
