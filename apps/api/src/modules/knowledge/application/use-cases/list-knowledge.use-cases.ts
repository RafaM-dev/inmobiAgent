import type { AppError } from "../../../../platform/errors/app-error";
import { NotFoundError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { DocumentSourceType, DocumentStatus } from "../../domain/entities/document";
import type {
  DocumentRepository,
  KnowledgeCollectionRepository,
} from "../../domain/repositories/knowledge.repositories";

/**
 * Consultas de lectura de la base de conocimiento.
 *
 * Son casos de uso y no llamadas directas al repositorio desde la ruta por la
 * misma razón de siempre: la capa `interface` no conoce persistencia. El día
 * que esto se sirva de una vista materializada o de una caché, no habrá que
 * tocar ni una ruta.
 */

export interface CollectionView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
  readonly documentCount: number;
}

export interface DocumentView {
  readonly id: string;
  readonly collectionId: string;
  readonly title: string;
  readonly sourceType: DocumentSourceType;
  readonly mimeType: string;
  readonly status: DocumentStatus;
  readonly chunkCount: number;
  readonly embeddingModel?: string;
  readonly failureReason?: string;
  readonly indexedAt?: Date;
  readonly updatedAt: Date;
}

export class ListCollectionsUseCase {
  constructor(
    private readonly deps: {
      collections: KnowledgeCollectionRepository;
      documents: DocumentRepository;
    },
  ) {}

  async execute(): Promise<Result<readonly CollectionView[], AppError>> {
    const collections = await this.deps.collections.list();

    // El recuento se CONSULTA, no se guarda en la colección: un contador
    // denormalizado se desincroniza y una pantalla que dice "(7)" con cuatro
    // documentos dentro hace dudar de todo lo demás que muestra.
    const counts = await this.deps.documents.countByCollection(
      collections.map((collection) => collection.id),
    );

    return ok(
      collections.map((collection) => {
        const props = collection.snapshot();
        return {
          id: props.id,
          slug: props.slug,
          name: props.name,
          ...(props.description !== undefined ? { description: props.description } : {}),
          documentCount: counts[props.id] ?? 0,
        };
      }),
    );
  }
}

const DEFAULT_LIMIT = 100;

export class ListDocumentsUseCase {
  constructor(
    private readonly deps: {
      collections: KnowledgeCollectionRepository;
      documents: DocumentRepository;
    },
  ) {}

  async execute(input: {
    collectionId: string;
    limit?: number;
  }): Promise<Result<readonly DocumentView[], AppError>> {
    /*
     * La colección se comprueba ANTES de listar. `listByCollection` acotado por
     * tenant devolvería una lista vacía para una colección de otra inmobiliaria,
     * y "vacío" y "no existe" son respuestas distintas: la primera hace pensar
     * al asesor que sus documentos desaparecieron.
     */
    const collection = await this.deps.collections.findById(input.collectionId);
    if (!collection) return err(new NotFoundError("Colección", input.collectionId));

    const documents = await this.deps.documents.listByCollection(
      collection.id,
      input.limit ?? DEFAULT_LIMIT,
    );

    return ok(
      documents.map((document) => {
        const props = document.snapshot();
        return {
          id: props.id,
          collectionId: props.collectionId,
          title: props.title,
          sourceType: props.sourceType,
          mimeType: props.mimeType,
          status: props.status,
          chunkCount: props.chunkCount,
          ...(props.embeddingModel !== undefined ? { embeddingModel: props.embeddingModel } : {}),
          ...(props.failureReason !== undefined ? { failureReason: props.failureReason } : {}),
          ...(props.indexedAt !== undefined ? { indexedAt: props.indexedAt } : {}),
          updatedAt: props.updatedAt,
        };
      }),
    );
  }
}
