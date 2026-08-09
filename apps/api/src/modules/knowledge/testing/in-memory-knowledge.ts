import type { Clock } from "../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../platform/database/unit-of-work";
import type { AppError } from "../../../platform/errors/app-error";
import type { EventPublisher } from "../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../platform/ids/id-generator";
import type { Logger } from "../../../platform/logging/logger";
import { isErr, type Result } from "../../../platform/result/result";
import { MemoryFileStorage } from "../../../platform/storage/memory-file-storage";
import { HeuristicTokenCounter } from "../../../platform/text/token-counter";
import type { KnowledgeService } from "../application/ports/knowledge-service";
import { ExtractorRegistry } from "../application/services/extractor-registry";
import { KnowledgeServiceFacade } from "../application/services/knowledge-service.facade";
import { CreateCollectionUseCase } from "../application/use-cases/create-collection.use-case";
import { IndexDocumentUseCase } from "../application/use-cases/index-document.use-case";
import {
  IngestDocumentUseCase,
  type IngestDocumentCommand,
} from "../application/use-cases/ingest-document.use-case";
import { SearchKnowledgeUseCase } from "../application/use-cases/search-knowledge.use-case";
import { DocumentSourceType } from "../domain/entities/document";
import { MockEmbeddingProvider } from "../infrastructure/embeddings/mock/mock-embedding-provider";
import { PlainTextExtractor } from "../infrastructure/extraction/plain-text.extractor";
import {
  InMemoryChunkRepository,
  InMemoryCollectionRepository,
  InMemoryDocumentRepository,
} from "./in-memory-knowledge.repositories";

/**
 * `knowledge` completo en memoria, con los casos de uso REALES.
 *
 * Permite que el agente se pruebe contra una base de conocimiento que se
 * comporta como la de producción —ingesta idempotente, troceado, embeddings,
 * búsqueda híbrida y `NO_ANSWER`— sin Postgres y sin importar nada de dentro de
 * este módulo. Mismo patrón que `createInMemoryCatalog` y `createInMemoryLeads`.
 */
export interface InMemoryKnowledge {
  readonly service: KnowledgeService;
  readonly chunks: InMemoryChunkRepository;
  readonly documents: InMemoryDocumentRepository;
  /** Ingesta e indexa de una vez: en producción los une un evento. */
  addDocument(input: {
    collection: string;
    title: string;
    text: string;
  }): Promise<Result<{ documentId: string; chunkCount: number }, AppError>>;
}

export const createInMemoryKnowledge = (deps: {
  events: EventPublisher;
  clock: Clock;
  logger: Logger;
}): InMemoryKnowledge => {
  const collections = new InMemoryCollectionRepository();
  const documents = new InMemoryDocumentRepository();
  const chunks = new InMemoryChunkRepository();
  const storage = new MemoryFileStorage();
  const embeddings = new MockEmbeddingProvider();
  const unitOfWork = new NoopUnitOfWork();
  const ids = new SequentialIdGenerator("kn");

  const extractors = new ExtractorRegistry();
  extractors.register(new PlainTextExtractor());

  const createCollection = new CreateCollectionUseCase({
    collections,
    unitOfWork,
    clock: deps.clock,
    ids,
  });

  const ingest = new IngestDocumentUseCase({
    collections,
    documents,
    extractors,
    storage,
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
    ids,
    maxDocumentBytes: 5_242_880,
  });

  const index = new IndexDocumentUseCase({
    documents,
    chunks,
    extractors,
    embeddings,
    storage,
    tokens: new HeuristicTokenCounter(),
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
    logger: deps.logger,
  });

  const search = new SearchKnowledgeUseCase({
    chunks,
    collections,
    embeddings,
    logger: deps.logger,
  });

  return {
    chunks,
    documents,
    service: new KnowledgeServiceFacade({ search }),

    async addDocument(input) {
      const collection = await createCollection.execute({ name: input.collection });
      if (isErr(collection)) return collection;

      const command: IngestDocumentCommand = {
        collectionId: collection.value.id,
        title: input.title,
        sourceType: DocumentSourceType.TEXT,
        mimeType: "text/markdown",
        content: Buffer.from(input.text, "utf8"),
      };

      const ingested = await ingest.execute(command);
      if (isErr(ingested)) return ingested;

      // En producción esto lo dispara `knowledge.document_ingested`; aquí se
      // encadena a mano para que un test no necesite un bus de eventos.
      chunks.registerDocument(ingested.value.documentId, {
        title: ingested.value.title,
        collectionId: collection.value.id,
        collectionName: collection.value.name,
      });

      const indexed = await index.execute(ingested.value.documentId);
      if (isErr(indexed)) return indexed;

      return {
        ok: true,
        value: { documentId: ingested.value.documentId, chunkCount: indexed.value.chunkCount },
      };
    },
  };
};
