import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import { ok, type Result } from "../../../../platform/result/result";
import type { PropertySnapshotRepository } from "../../domain/repositories/property-snapshot.repository";
import { PropertySnapshot } from "../../domain/value-objects/property-snapshot";
import { PropertyShown } from "../events/catalog.events";
import type { Property } from "../ports/property-service";

export interface RecordPropertyShownCommand {
  readonly conversationId: string;
  readonly contactId: string;
  readonly properties: readonly Property[];
  /** Enlaces e imágenes, si ya se consultaron. Evita pedirlos otra vez. */
  readonly extras?: Readonly<Record<string, { url?: string; imageUrl?: string }>>;
}

export interface RecordPropertyShownResult {
  readonly snapshotIds: readonly string[];
}

/**
 * Deja constancia de lo que se le mostró a un cliente.
 *
 * Es lo que convierte una conversación en algo auditable y en algo sobre lo que
 * construir: un lead sabrá qué inmuebles despertaron interés (F4) y una cita
 * podrá referenciar uno sin que seamos dueños del catálogo.
 *
 * Snapshots y evento van en la misma transacción: no puede existir un
 * `PropertyShown` que apunte a snapshots que no se guardaron.
 */
export class RecordPropertyShownUseCase {
  constructor(
    private readonly deps: {
      snapshots: PropertySnapshotRepository;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
    },
  ) {}

  async execute(
    command: RecordPropertyShownCommand,
  ): Promise<Result<RecordPropertyShownResult, AppError>> {
    if (command.properties.length === 0) return ok({ snapshotIds: [] });

    const capturedAt = this.deps.clock.now();

    const snapshots = command.properties.map((property) => {
      const extra = command.extras?.[property.ref.key];
      return PropertySnapshot.capture({
        ref: property.ref,
        title: property.title,
        operation: property.operation,
        type: property.type,
        price: property.price,
        city: property.city,
        neighborhood: property.neighborhood,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        areaM2: property.areaM2,
        imageUrl: extra?.imageUrl,
        url: extra?.url,
        capturedAt,
      });
    });

    const snapshotIds = await this.deps.unitOfWork.run(async () => {
      const stored = await this.deps.snapshots.saveAll(snapshots);
      const ids = stored.map((entry) => entry.id);

      await this.deps.snapshots.recordImpressions({
        conversationId: command.conversationId,
        contactId: command.contactId,
        snapshotIds: ids,
        shownAt: capturedAt,
      });

      await this.deps.events.publish(PropertyShown, {
        conversationId: command.conversationId,
        contactId: command.contactId,
        refs: command.properties.map((property) => property.ref.key),
        snapshotIds: ids,
      });

      return ids;
    });

    return ok({ snapshotIds });
  }
}
