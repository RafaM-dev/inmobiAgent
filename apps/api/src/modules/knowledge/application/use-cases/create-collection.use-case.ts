import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { KnowledgeCollection, slugify } from "../../domain/entities/knowledge-collection";
import type { KnowledgeCollectionRepository } from "../../domain/repositories/knowledge.repositories";

export interface CreateCollectionCommand {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
}

export interface CollectionView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly created: boolean;
}

/**
 * Alta de una colección. **Idempotente por slug**: volver a crear "Políticas"
 * devuelve la que ya existe en vez de duplicarla. Es lo que permite que el seed
 * y el back-office llamen a esto sin comprobar antes.
 */
export class CreateCollectionUseCase {
  constructor(
    private readonly deps: {
      collections: KnowledgeCollectionRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(command: CreateCollectionCommand): Promise<Result<CollectionView, AppError>> {
    const slug = slugify(command.slug ?? command.name);
    const existing = await this.deps.collections.findBySlug(slug);

    if (existing) {
      return ok({
        id: existing.id,
        name: existing.name,
        slug: existing.slug,
        created: false,
      });
    }

    const collection = KnowledgeCollection.create({
      id: this.deps.ids.generate(),
      tenantId: TenantContext.requireTenantId(),
      name: command.name,
      ...(command.slug !== undefined ? { slug: command.slug } : {}),
      ...(command.description !== undefined ? { description: command.description } : {}),
      now: this.deps.clock.now(),
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.collections.save(collection);
    });

    return ok({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      created: true,
    });
  }
}
