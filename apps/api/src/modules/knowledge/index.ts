import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { EventSubscription } from "../../platform/events/event";
import { HeuristicTokenCounter } from "../../platform/text/token-counter";
import { onDocumentIngested } from "./application/event-handlers/on-document-ingested";
import type { EmbeddingProvider } from "./application/ports/embedding-provider";
import type { KnowledgeService } from "./application/ports/knowledge-service";
import { ExtractorRegistry } from "./application/services/extractor-registry";
import { KnowledgeServiceFacade } from "./application/services/knowledge-service.facade";
import { CreateCollectionUseCase } from "./application/use-cases/create-collection.use-case";
import { IndexDocumentUseCase } from "./application/use-cases/index-document.use-case";
import { IngestDocumentUseCase } from "./application/use-cases/ingest-document.use-case";
import {
  DeleteDocumentUseCase,
  ReindexDocumentUseCase,
} from "./application/use-cases/manage-document.use-cases";
import {
  ListCollectionsUseCase,
  ListDocumentsUseCase,
} from "./application/use-cases/list-knowledge.use-cases";
import { SearchKnowledgeUseCase } from "./application/use-cases/search-knowledge.use-case";
import { registerKnowledgeRoutes } from "./interface/http/knowledge.routes";
import { requireRole, requireSession, UserRole, type IdentityCradle } from "../identity";
import type {
  DocumentChunkRepository,
  DocumentRepository,
  KnowledgeCollectionRepository,
} from "./domain/repositories/knowledge.repositories";
import { MockEmbeddingProvider } from "./infrastructure/embeddings/mock/mock-embedding-provider";
import { PlainTextExtractor } from "./infrastructure/extraction/plain-text.extractor";
import {
  PrismaDocumentChunkRepository,
  PrismaDocumentRepository,
  PrismaKnowledgeCollectionRepository,
} from "./infrastructure/persistence/prisma/prisma-knowledge.repositories";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `knowledge`
 *
 * Lo que la inmobiliaria sabe y el agente puede CITAR. La diferencia con
 * `catalog` importa: el catálogo es de un proveedor y solo guardamos
 * referencias; esto es de la inmobiliaria, y por eso sí vive entero aquí.
 * ========================================================================== */

export type {
  KnowledgeService,
  KnowledgeAnswer,
  KnowledgePassage,
  SearchKnowledgeCommand,
} from "./application/ports/knowledge-service";
export type { EmbeddingProvider } from "./application/ports/embedding-provider";
export type { Citation } from "./domain/value-objects/citation";
export { DocumentSourceType, DocumentStatus } from "./domain/entities/document";
export type { IngestDocumentCommand } from "./application/use-cases/ingest-document.use-case";
export type { CreateCollectionCommand } from "./application/use-cases/create-collection.use-case";
export {
  DocumentIngested,
  DocumentIndexed,
  IngestionFailed,
  type DocumentIngestedPayload,
  type DocumentIndexedPayload,
} from "./application/events/knowledge.events";

export interface KnowledgeCradle {
  knowledgeCollectionRepository: KnowledgeCollectionRepository;
  documentRepository: DocumentRepository;
  documentChunkRepository: DocumentChunkRepository;
  embeddingProvider: EmbeddingProvider;
  extractorRegistry: ExtractorRegistry;

  createCollection: CreateCollectionUseCase;
  listCollections: ListCollectionsUseCase;
  listDocuments: ListDocumentsUseCase;
  ingestDocument: IngestDocumentUseCase;
  indexDocument: IndexDocumentUseCase;
  reindexDocument: ReindexDocumentUseCase;
  deleteDocument: DeleteDocumentUseCase;
  searchKnowledge: SearchKnowledgeUseCase;

  /** Puerto público: es lo que consume el agente. */
  knowledgeService: KnowledgeService;
}

type Cradle = PlatformCradle & IdentityCradle & KnowledgeCradle;

export const knowledgeModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "knowledge",

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerKnowledgeRoutes(app, {
      listCollections: cradle.listCollections,
      listDocuments: cradle.listDocuments,
      createCollection: cradle.createCollection,
      ingestDocument: cradle.ingestDocument,
      reindexDocument: cradle.reindexDocument,
      deleteDocument: cradle.deleteDocument,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
      // Un `VIEWER` puede auditar qué sabe el agente; no puede cambiarlo.
      requireEditor: requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.AGENT),
    });
  },

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      knowledgeCollectionRepository: asFunction(
        (c: Cradle): KnowledgeCollectionRepository =>
          new PrismaKnowledgeCollectionRepository(c.database),
      ).singleton(),

      documentRepository: asFunction(
        (c: Cradle): DocumentRepository => new PrismaDocumentRepository(c.database),
      ).singleton(),

      documentChunkRepository: asFunction(
        (c: Cradle): DocumentChunkRepository =>
          new PrismaDocumentChunkRepository(c.database, c.ids),
      ).singleton(),

      /**
       * ÚNICO punto del sistema donde se elige el proveedor de embeddings.
       *
       * Cambiarlo NO es transparente y por eso el error lo dice: los vectores
       * de dos modelos no se pueden comparar (D25). Al cambiar de proveedor hay
       * que reindexar, y para eso se guarda el original de cada documento.
       */
      embeddingProvider: asFunction((c: Cradle): EmbeddingProvider => {
        switch (c.config.providers.embedding) {
          case "mock":
            return new MockEmbeddingProvider();
          default:
            throw new Error(
              `El proveedor de embeddings "${c.config.providers.embedding}" llega en F8. ` +
                "Usa EMBEDDING_PROVIDER=mock para el modo demo.",
            );
        }
      }).singleton(),

      extractorRegistry: asFunction(() => {
        const registry = new ExtractorRegistry();
        registry.register(new PlainTextExtractor());
        return registry;
      }).singleton(),

      createCollection: asFunction(
        (c: Cradle) =>
          new CreateCollectionUseCase({
            collections: c.knowledgeCollectionRepository,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
            ids: c.ids,
          }),
      ).singleton(),

      listCollections: asFunction(
        (c: Cradle) =>
          new ListCollectionsUseCase({
            collections: c.knowledgeCollectionRepository,
            documents: c.documentRepository,
          }),
      ).singleton(),

      listDocuments: asFunction(
        (c: Cradle) =>
          new ListDocumentsUseCase({
            collections: c.knowledgeCollectionRepository,
            documents: c.documentRepository,
          }),
      ).singleton(),

      ingestDocument: asFunction(
        (c: Cradle) =>
          new IngestDocumentUseCase({
            collections: c.knowledgeCollectionRepository,
            documents: c.documentRepository,
            extractors: c.extractorRegistry,
            storage: c.fileStorage,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
            maxDocumentBytes: c.config.knowledge.maxDocumentBytes,
          }),
      ).singleton(),

      indexDocument: asFunction(
        (c: Cradle) =>
          new IndexDocumentUseCase({
            documents: c.documentRepository,
            chunks: c.documentChunkRepository,
            extractors: c.extractorRegistry,
            embeddings: c.embeddingProvider,
            storage: c.fileStorage,
            tokens: new HeuristicTokenCounter(),
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "knowledge" }),
          }),
      ).singleton(),

      reindexDocument: asFunction(
        (c: Cradle) =>
          new ReindexDocumentUseCase({
            documents: c.documentRepository,
            chunks: c.documentChunkRepository,
            storage: c.fileStorage,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "knowledge" }),
          }),
      ).singleton(),

      deleteDocument: asFunction(
        (c: Cradle) =>
          new DeleteDocumentUseCase({
            documents: c.documentRepository,
            chunks: c.documentChunkRepository,
            storage: c.fileStorage,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "knowledge" }),
          }),
      ).singleton(),

      searchKnowledge: asFunction(
        (c: Cradle) =>
          new SearchKnowledgeUseCase({
            chunks: c.documentChunkRepository,
            collections: c.knowledgeCollectionRepository,
            embeddings: c.embeddingProvider,
            logger: c.logger.child({ module: "knowledge" }),
          }),
      ).singleton(),

      knowledgeService: asFunction(
        (c: Cradle): KnowledgeService => new KnowledgeServiceFacade({ search: c.searchKnowledge }),
      ).singleton(),
    });
  },

  registerSubscriptions(cradle: Cradle): EventSubscription[] {
    return [
      onDocumentIngested({
        indexDocument: cradle.indexDocument,
        logger: cradle.logger.child({ module: "knowledge" }),
      }),
    ];
  },
};
