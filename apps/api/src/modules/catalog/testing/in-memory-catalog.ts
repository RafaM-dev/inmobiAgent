import type { Clock } from "../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../platform/database/unit-of-work";
import type { EventPublisher } from "../../../platform/events/event-publisher";
import type { Logger } from "../../../platform/logging/logger";
import type { CatalogService } from "../application/ports/catalog-service";
import { CatalogServiceFacade } from "../application/services/catalog-service.facade";
import {
  CheckPropertyAvailabilityUseCase,
  GetPropertyDetailsUseCase,
  GetPropertyMediaUseCase,
} from "../application/use-cases/get-property-details.use-case";
import { RecordPropertyShownUseCase } from "../application/use-cases/record-property-shown.use-case";
import { SearchPropertiesUseCase } from "../application/use-cases/search-properties.use-case";
import type {
  PropertySnapshotRepository,
  RecordImpressionsInput,
  StoredSnapshot,
} from "../domain/repositories/property-snapshot.repository";
import type { PropertyRef } from "../domain/value-objects/property-ref";
import type { PropertySnapshot } from "../domain/value-objects/property-snapshot";
import { MockPropertyService } from "../infrastructure/providers/mock/mock-property.service";

/**
 * Catálogo completo en memoria, para que otros módulos prueben contra el
 * comportamiento REAL en vez de contra un doble que finge.
 *
 * Los casos de uso, el filtrado y la captura de snapshots son los de
 * producción; lo único simulado es la persistencia y el proveedor, que ya es
 * simulado en el modo demo de todas formas.
 */

export class InMemorySnapshotRepository implements PropertySnapshotRepository {
  readonly stored = new Map<string, StoredSnapshot>();
  readonly impressions: RecordImpressionsInput[] = [];
  private sequence = 0;

  saveAll(snapshots: readonly PropertySnapshot[]): Promise<StoredSnapshot[]> {
    const result: StoredSnapshot[] = [];
    for (const snapshot of snapshots) {
      const key = `${snapshot.ref.key}:${snapshot.checksum}`;
      const existing = this.stored.get(key);
      if (existing) {
        result.push(existing);
        continue;
      }
      this.sequence += 1;
      const entry = { id: `snap-${String(this.sequence)}`, snapshot };
      this.stored.set(key, entry);
      result.push(entry);
    }
    return Promise.resolve(result);
  }

  recordImpressions(input: RecordImpressionsInput): Promise<void> {
    this.impressions.push(input);
    return Promise.resolve();
  }

  findLatest(ref: PropertyRef): Promise<StoredSnapshot | null> {
    for (const entry of [...this.stored.values()].reverse()) {
      if (entry.snapshot.ref.key === ref.key) return Promise.resolve(entry);
    }
    return Promise.resolve(null);
  }

  listShownIn(): Promise<StoredSnapshot[]> {
    return Promise.resolve([...this.stored.values()]);
  }
}

export interface InMemoryCatalog {
  readonly service: CatalogService;
  readonly snapshots: InMemorySnapshotRepository;
  readonly properties: MockPropertyService;
}

export const createInMemoryCatalog = (deps: {
  events: EventPublisher;
  clock: Clock;
  logger: Logger;
}): InMemoryCatalog => {
  const properties = new MockPropertyService();
  const snapshots = new InMemorySnapshotRepository();

  const service = new CatalogServiceFacade({
    search: new SearchPropertiesUseCase({
      properties,
      events: deps.events,
      clock: deps.clock,
      logger: deps.logger,
    }),
    details: new GetPropertyDetailsUseCase({ properties }),
    availability: new CheckPropertyAvailabilityUseCase({ properties }),
    media: new GetPropertyMediaUseCase({ properties }),
    recordShown: new RecordPropertyShownUseCase({
      snapshots,
      unitOfWork: new NoopUnitOfWork(),
      events: deps.events,
      clock: deps.clock,
    }),
  });

  return { service, snapshots, properties };
};
