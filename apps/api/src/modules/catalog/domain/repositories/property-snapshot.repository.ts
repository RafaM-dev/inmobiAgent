import type { PropertyRef } from "../value-objects/property-ref";
import type { PropertySnapshot } from "../value-objects/property-snapshot";

export interface StoredSnapshot {
  readonly id: string;
  readonly snapshot: PropertySnapshot;
}

export interface RecordImpressionsInput {
  readonly conversationId: string;
  readonly contactId: string;
  readonly snapshotIds: readonly string[];
  readonly shownAt: Date;
}

/**
 * Persistencia de lo mostrado.
 *
 * `saveAll` es idempotente por `(tenant, source, externalId, checksum)`: enseñar
 * dos veces el mismo inmueble sin cambios reutiliza la fila. Solo cuando el
 * proveedor cambia un dato aparece una versión nueva, y entonces conviven las
 * dos: la que vio el cliente el martes y la de hoy.
 */
export interface PropertySnapshotRepository {
  saveAll(snapshots: readonly PropertySnapshot[]): Promise<StoredSnapshot[]>;
  recordImpressions(input: RecordImpressionsInput): Promise<void>;
  /** Última versión conocida de un inmueble. La usa el back-office (F7). */
  findLatest(ref: PropertyRef): Promise<StoredSnapshot | null>;
  /** Lo mostrado en una conversación, de lo más reciente a lo más antiguo. */
  listShownIn(conversationId: string, limit: number): Promise<StoredSnapshot[]>;
}
