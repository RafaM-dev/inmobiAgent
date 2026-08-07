import { createHash } from "node:crypto";
import type { Database } from "../../../../../platform/database/prisma";
import type { Logger } from "../../../../../platform/logging/logger";
import type { ConversationLock } from "../../../domain/repositories/conversation.repositories";

/**
 * Candado por conversación con advisory locks de Postgres.
 *
 * Por qué advisory y no `SELECT … FOR UPDATE`: no queremos bloquear filas —
 * queremos serializar *el trabajo* de un turno, que incluye llamadas al modelo
 * de IA y a proveedores externos. Un lock de fila mantenido durante segundos
 * degradaría toda la base.
 *
 * `pg_try_advisory_xact_lock` no espera: si otro proceso lo tiene, devuelve
 * `false` de inmediato y este turno se descarta. Es lo correcto — el proceso
 * que lo tiene ya está atendiendo los mismos mensajes.
 *
 * El lock se libera solo al terminar la transacción, incluso si el proceso
 * muere: no hay candados huérfanos.
 */
export class PostgresConversationLock implements ConversationLock {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /** UUID → bigint estable. Postgres exige un entero de 64 bits. */
  private key(conversationId: string): bigint {
    const digest = createHash("sha1").update(conversationId).digest();
    // 63 bits: el bit de signo se descarta para no salirse de int8.
    return digest.readBigUInt64BE(0) & 0x7fff_ffff_ffff_ffffn;
  }

  async withLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T | null> {
    const key = this.key(conversationId);

    return this.db.run(async () => {
      const rows = await this.db
        .client()
        .$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;

      if (rows[0]?.locked !== true) {
        this.logger.debug("Turno omitido: la conversación ya está siendo atendida", {
          conversationId,
        });
        return null;
      }

      return fn();
    });
  }
}
