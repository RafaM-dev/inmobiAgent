import type { PropertySnapshot as PrismaSnapshot } from "@prisma/client";
import type { Database } from "../../../../../platform/database/prisma";
import { tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import type {
  PropertySnapshotRepository,
  RecordImpressionsInput,
  StoredSnapshot,
} from "../../../domain/repositories/property-snapshot.repository";
import { PropertyRef } from "../../../domain/value-objects/property-ref";
import { PropertySnapshot } from "../../../domain/value-objects/property-snapshot";

const toDomain = (row: PrismaSnapshot): StoredSnapshot => ({
  id: row.id,
  snapshot: PropertySnapshot.rehydrate(
    {
      ref: PropertyRef.create(row.source, row.externalId),
      title: row.title,
      operation: row.operation,
      type: row.type,
      // BigInt en la base para que un precio grande nunca se desborde;
      // Number en el dominio, donde los importes caben de sobra.
      price: { amount: Number(row.priceAmount), currency: row.currency },
      city: row.city,
      neighborhood: row.neighborhood ?? undefined,
      bedrooms: row.bedrooms ?? undefined,
      bathrooms: row.bathrooms ?? undefined,
      areaM2: row.areaM2 ?? undefined,
      imageUrl: row.imageUrl ?? undefined,
      url: row.url ?? undefined,
      capturedAt: row.capturedAt,
    },
    row.checksum,
  ),
});

export class PrismaPropertySnapshotRepository implements PropertySnapshotRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async saveAll(snapshots: readonly PropertySnapshot[]): Promise<StoredSnapshot[]> {
    const { tenantId } = tenantScope();
    const client = this.db.client();
    const stored: StoredSnapshot[] = [];

    for (const snapshot of snapshots) {
      const data = snapshot.snapshot();

      // Upsert por la huella de los datos: mostrar lo mismo dos veces no crea
      // filas nuevas, pero un cambio de precio sí conserva ambas versiones.
      const row = await client.propertySnapshot.upsert({
        where: {
          tenantId_source_externalId_checksum: {
            tenantId,
            source: data.ref.source,
            externalId: data.ref.externalId,
            checksum: snapshot.checksum,
          },
        },
        create: {
          id: this.ids.generate(),
          tenantId,
          source: data.ref.source,
          externalId: data.ref.externalId,
          checksum: snapshot.checksum,
          title: data.title,
          operation: data.operation,
          type: data.type,
          priceAmount: BigInt(data.price.amount),
          currency: data.price.currency,
          city: data.city,
          neighborhood: data.neighborhood ?? null,
          bedrooms: data.bedrooms ?? null,
          bathrooms: data.bathrooms ?? null,
          areaM2: data.areaM2 ?? null,
          imageUrl: data.imageUrl ?? null,
          url: data.url ?? null,
          capturedAt: data.capturedAt,
        },
        // Un snapshot es inmutable: si ya existe, no se toca nada.
        update: {},
      });

      stored.push(toDomain(row));
    }

    return stored;
  }

  async recordImpressions(input: RecordImpressionsInput): Promise<void> {
    if (input.snapshotIds.length === 0) return;
    const { tenantId } = tenantScope();

    await this.db.client().propertyImpression.createMany({
      data: input.snapshotIds.map((snapshotId) => ({
        id: this.ids.generate(),
        tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        snapshotId,
        shownAt: input.shownAt,
      })),
    });
  }

  async findLatest(ref: PropertyRef): Promise<StoredSnapshot | null> {
    const row = await this.db.client().propertySnapshot.findFirst({
      where: { ...tenantScope(), source: ref.source, externalId: ref.externalId },
      orderBy: { capturedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async listShownIn(conversationId: string, limit: number): Promise<StoredSnapshot[]> {
    const rows = await this.db.client().propertyImpression.findMany({
      where: { ...tenantScope(), conversationId },
      orderBy: { shownAt: "desc" },
      take: limit,
      include: { snapshot: true },
    });

    // Un mismo inmueble puede haberse mostrado varias veces: interesa una vez.
    const seen = new Set<string>();
    const result: StoredSnapshot[] = [];
    for (const row of rows) {
      if (seen.has(row.snapshotId)) continue;
      seen.add(row.snapshotId);
      result.push(toDomain(row.snapshot));
    }
    return result;
  }
}
