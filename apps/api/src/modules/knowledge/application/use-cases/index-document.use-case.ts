import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import type { FileStorage } from "../../../../platform/storage/file-storage";
import type { TokenCounter } from "../../../../platform/text/token-counter";
import type { Document } from "../../domain/entities/document";
import { EXTRACTED_MIME } from "./ingest-document.use-case";
import {
  chunkDocument,
  toEmbeddableText,
  type ChunkOptions,
} from "../../domain/policies/chunking.policy";
import type {
  DocumentChunkRepository,
  DocumentRepository,
  IndexedChunk,
} from "../../domain/repositories/knowledge.repositories";
import { DocumentIndexed, IngestionFailed } from "../events/knowledge.events";
import type { EmbeddingProvider } from "../ports/embedding-provider";
import type { ExtractorRegistry } from "../services/extractor-registry";

/** Fragmentos por llamada al proveedor. Los proveedores reales cobran por lote. */
const EMBED_BATCH = 32;

export interface IndexDocumentResult {
  readonly documentId: string;
  readonly chunkCount: number;
  readonly skipped: boolean;
}

/**
 * `IndexDocument` — troceado, vectorizado e indexado.
 *
 * Es lo que convierte un archivo en algo que el agente puede citar. Corre como
 * consumidor de `knowledge.document_ingested`, así que hereda del outbox los
 * reintentos y la entrega garantizada.
 *
 * **Idempotente por construcción**: `replaceAll` borra los fragmentos previos
 * del documento antes de escribir los nuevos. Que el evento llegue dos veces
 * produce el mismo índice, no el doble de fragmentos — y en un RAG, fragmentos
 * duplicados son respuestas que se citan a sí mismas tres veces.
 *
 * Un fallo NO se relanza: se marca el documento como `FAILED` con su motivo y
 * ahí se queda. Reintentar en bucle un PDF que no sabemos leer no lo arregla;
 * lo que hace falta es que alguien lo vea, y para eso está el estado.
 */
export class IndexDocumentUseCase {
  constructor(
    private readonly deps: {
      documents: DocumentRepository;
      chunks: DocumentChunkRepository;
      extractors: ExtractorRegistry;
      embeddings: EmbeddingProvider;
      storage: FileStorage;
      tokens: TokenCounter;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      logger: Logger;
      chunking?: ChunkOptions;
    },
  ) {}

  async execute(documentId: string): Promise<Result<IndexDocumentResult, AppError>> {
    const document = await this.deps.documents.findById(documentId);
    if (!document) return err(new NotFoundError("Documento", documentId));

    // Ya indexado con este mismo modelo: no hay nada que hacer. Es lo que
    // absorbe una segunda entrega del evento.
    if (document.isIndexed && document.embeddingModel === this.deps.embeddings.model) {
      return ok({ documentId, chunkCount: document.chunkCount, skipped: true });
    }

    const startedAt = this.deps.clock.nowMs();

    try {
      document.startIndexing(this.deps.clock.now());
      await this.deps.documents.save(document);

      const chunks = await this.buildChunks(document);
      if (isErr(chunks)) return await this.fail(document, chunks.error.message);

      await this.deps.unitOfWork.run(async () => {
        await this.deps.chunks.replaceAll({
          documentId: document.id,
          embeddingModel: this.deps.embeddings.model,
          chunks: chunks.value,
        });

        document.markIndexed({
          chunkCount: chunks.value.length,
          embeddingModel: this.deps.embeddings.model,
          now: this.deps.clock.now(),
        });
        await this.deps.documents.save(document);

        await this.deps.events.publish(DocumentIndexed, {
          documentId: document.id,
          collectionId: document.collectionId,
          chunkCount: chunks.value.length,
          embeddingModel: this.deps.embeddings.model,
          durationMs: this.deps.clock.nowMs() - startedAt,
        });
      });

      this.deps.logger.info("Documento indexado", {
        documentId: document.id,
        chunks: chunks.value.length,
        model: this.deps.embeddings.model,
      });

      return ok({ documentId, chunkCount: chunks.value.length, skipped: false });
    } catch (error) {
      return await this.fail(document, error instanceof Error ? error.message : String(error));
    }
  }

  /* ---------------------------------------------------------------------- */

  private async buildChunks(document: Document): Promise<Result<IndexedChunk[], AppError>> {
    const ref = document.sourceRef;
    if (ref === undefined) {
      return err(new NotFoundError("Original del documento", document.id));
    }

    const original = await this.deps.storage.get(ref);
    if (isErr(original)) return original;

    /*
     * Se extrae como TEXTO, no con el tipo original del documento.
     *
     * Lo que hay guardado no es el PDF: es el texto que se sacó de él al
     * ingerirlo (ver `EXTRACTED_MIME`). Pasarle aquí `application/pdf` mandaría
     * ese texto al lector de PDF, que no sabría abrirlo — y el documento se
     * quedaría en fallo cada vez que alguien lo reindexara.
     */
    const extracted = await this.deps.extractors.extract({
      content: original.value,
      mimeType: EXTRACTED_MIME,
    });
    if (isErr(extracted)) return extracted;

    const pieces = chunkDocument(extracted.value.text, this.deps.tokens, this.deps.chunking);
    if (pieces.length === 0) return ok([]);

    const indexed: IndexedChunk[] = [];

    for (let start = 0; start < pieces.length; start += EMBED_BATCH) {
      const batch = pieces.slice(start, start + EMBED_BATCH);

      // Al vector se le antepone el encabezado; a la cita, no. Así "sesenta
      // días de preaviso" queda cerca de "terminación anticipada" en el espacio
      // vectorial sin ensuciar el texto literal que verá el cliente.
      const vectors = await this.deps.embeddings.embedDocuments(batch.map(toEmbeddableText));
      if (isErr(vectors)) return vectors;

      batch.forEach((piece, offset) => {
        const embedding = vectors.value[offset];
        if (!embedding) return;

        indexed.push({
          ordinal: piece.ordinal,
          content: piece.content,
          tokens: piece.tokens,
          ...(piece.heading !== undefined ? { heading: piece.heading } : {}),
          embedding,
        });
      });
    }

    return ok(indexed);
  }

  private async fail(
    document: Document,
    reason: string,
  ): Promise<Result<IndexDocumentResult, AppError>> {
    document.markFailed(reason, this.deps.clock.now());

    await this.deps.unitOfWork.run(async () => {
      await this.deps.documents.save(document);
      await this.deps.events.publish(IngestionFailed, { documentId: document.id, reason });
    });

    this.deps.logger.warn("No se pudo indexar el documento", {
      documentId: document.id,
      reason,
    });

    return ok({ documentId: document.id, chunkCount: 0, skipped: false });
  }
}
