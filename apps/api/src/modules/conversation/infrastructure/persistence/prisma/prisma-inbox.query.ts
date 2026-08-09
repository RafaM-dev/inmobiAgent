import { Prisma } from "@prisma/client";
import type { Database } from "../../../../../platform/database/prisma";
import { tenantScope } from "../../../../../platform/database/tenant-scope";
import { blocksToText, type ChannelType } from "../../../../channels";
import type { ConversationStage, ConversationStatus } from "../../../domain/entities/conversation";
import type {
  InboxEntry,
  InboxFilter,
  InboxQuery,
} from "../../../domain/repositories/inbox.query";

/** Longitud de la vista previa en la lista. Lo justo para reconocer el hilo. */
const PREVIEW_LENGTH = 120;

interface InboxRow {
  id: string;
  contact_id: string;
  contact_name: string;
  channel_type: ChannelType;
  status: ConversationStatus;
  stage: ConversationStage;
  assigned_user_id: string | null;
  last_activity_at: Date;
  last_blocks: unknown;
  last_author: string | null;
  last_sent_at: Date | null;
  message_count: bigint;
}

/**
 * Bandeja en una sola consulta.
 *
 * Se escribe en SQL crudo por el `LATERAL`: para cada conversación hace falta su
 * ÚLTIMO mensaje, y con el ORM eso son mil consultas o traerse todos los
 * mensajes a memoria. Postgres lo resuelve con un índice y una pasada.
 *
 * La proyección a texto de los bloques sí se hace en TypeScript, con la misma
 * función que usa el resto del sistema (`blocksToText`): duplicarla en SQL sería
 * tener dos verdades sobre qué dice un mensaje.
 */
export class PrismaInboxQuery implements InboxQuery {
  constructor(private readonly db: Database) {}

  async list(filter: InboxFilter): Promise<readonly InboxEntry[]> {
    const { tenantId } = tenantScope();

    const rows = await this.db.client().$queryRaw<InboxRow[]>`
      SELECT c.id,
             c.contact_id,
             ct.display_name        AS contact_name,
             c.channel_type,
             c.status,
             c.stage,
             c.assigned_user_id,
             c.last_activity_at,
             last.blocks            AS last_blocks,
             last.author_type       AS last_author,
             last.sent_at           AS last_sent_at,
             COALESCE(total.count, 0) AS message_count
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN LATERAL (
        SELECT m.blocks, m.author_type, m.sent_at
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.sent_at DESC
        LIMIT 1
      ) last ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::bigint AS count
        FROM messages m
        WHERE m.conversation_id = c.id
      ) total ON TRUE
      WHERE c.tenant_id = ${tenantId}
        ${filter.status ? Prisma.sql`AND c.status = ${filter.status}::"ConversationStatus"` : Prisma.empty}
        ${
          filter.assignedUserId
            ? Prisma.sql`AND c.assigned_user_id = ${filter.assignedUserId}`
            : Prisma.empty
        }
      ORDER BY c.last_activity_at DESC
      LIMIT ${filter.limit}
      OFFSET ${filter.offset ?? 0}`;

    return rows.map((row) => toEntry(row));
  }

  async count(filter: Omit<InboxFilter, "limit" | "offset">): Promise<number> {
    const total = await this.db.client().conversation.count({
      where: {
        ...tenantScope(),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.assignedUserId ? { assignedUserId: filter.assignedUserId } : {}),
      },
    });
    return total;
  }
}

const toEntry = (row: InboxRow): InboxEntry => {
  const blocks = Array.isArray(row.last_blocks)
    ? (row.last_blocks as Parameters<typeof blocksToText>[0])
    : [];
  const preview = blocksToText(blocks).replace(/\s+/g, " ").trim();

  return {
    conversationId: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    channelType: row.channel_type,
    status: row.status,
    stage: row.stage,
    ...(row.assigned_user_id !== null ? { assignedUserId: row.assigned_user_id } : {}),
    lastMessagePreview:
      preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH)}…` : preview,
    lastMessageAt: row.last_sent_at ?? row.last_activity_at,
    lastMessageFrom: row.last_author ?? "SYSTEM",
    messageCount: Number(row.message_count),
    lastActivityAt: row.last_activity_at,
  };
};
