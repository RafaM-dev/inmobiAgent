import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `knowledge`.
 *
 * `DocumentIngested` es el que separa "guardar" de "indexar". Guardar tiene que
 * ser inmediato —el usuario acaba de subir un archivo y espera una respuesta—;
 * indexar puede tardar segundos y puede fallar. Publicando el evento dentro de
 * la misma transacción que el documento, el indexado hereda gratis los
 * reintentos y la idempotencia del outbox: si el proceso muere a mitad, el
 * relay lo vuelve a entregar.
 */

export interface DocumentIngestedPayload {
  readonly documentId: string;
  readonly collectionId: string;
  readonly title: string;
  /** Sube en cada reindexado: distingue una ingesta nueva de un reproceso. */
  readonly version: number;
}

export const DocumentIngested = defineEvent<DocumentIngestedPayload>(
  "knowledge.document_ingested",
);

export interface DocumentIndexedPayload {
  readonly documentId: string;
  readonly collectionId: string;
  readonly chunkCount: number;
  readonly embeddingModel: string;
  readonly durationMs: number;
}

export const DocumentIndexed = defineEvent<DocumentIndexedPayload>("knowledge.document_indexed");

export interface IngestionFailedPayload {
  readonly documentId: string;
  readonly reason: string;
}

export const IngestionFailed = defineEvent<IngestionFailedPayload>("knowledge.ingestion_failed");
