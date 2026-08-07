import { subscription, type EventSubscription } from "../../../../platform/events/event";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr } from "../../../../platform/result/result";
import { DocumentIngested, type DocumentIngestedPayload } from "../events/knowledge.events";
import type { IndexDocumentUseCase } from "../use-cases/index-document.use-case";

/**
 * `knowledge.document_ingested` → troceado, vectorizado e indexado.
 *
 * El indexado vive detrás de un evento y no dentro de la subida por una razón
 * práctica: subir tiene que responder al instante, y vectorizar un reglamento
 * de treinta páginas no. Además, al pasar por el outbox, un fallo del proceso a
 * mitad de indexado no pierde el trabajo: el relay vuelve a entregar el evento.
 */
export const onDocumentIngested = (deps: {
  indexDocument: IndexDocumentUseCase;
  logger: Logger;
}): EventSubscription =>
  subscription<DocumentIngestedPayload>(
    "knowledge.on-document-ingested",
    DocumentIngested,
    async (envelope) => {
      const result = await deps.indexDocument.execute(envelope.payload.documentId);

      if (isErr(result)) {
        deps.logger.warn("No se pudo indexar el documento", {
          documentId: envelope.payload.documentId,
          errorCode: result.error.code,
        });
      }
    },
  ) as EventSubscription;
