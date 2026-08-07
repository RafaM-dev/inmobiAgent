import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, okVoid, type Result } from "../../../../platform/result/result";
import type { FileStorage } from "../../../../platform/storage/file-storage";
import type {
  DocumentChunkRepository,
  DocumentRepository,
} from "../../domain/repositories/knowledge.repositories";
import { DocumentIngested } from "../events/knowledge.events";

interface Deps {
  documents: DocumentRepository;
  chunks: DocumentChunkRepository;
  storage: FileStorage;
  unitOfWork: UnitOfWork;
  events: EventPublisher;
  clock: Clock;
  logger: Logger;
}

/**
 * `ReindexDocument` — volver a empezar con el mismo original.
 *
 * Es la operación que hace posible cambiar de proveedor de embeddings sin
 * perder nada: se reencola el documento y el indexado lo vuelve a vectorizar
 * con el modelo activo. Por eso se guarda el original (D27); sin él habría que
 * pedirle al cliente que subiera otra vez sus documentos.
 */
export class ReindexDocumentUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(documentId: string): Promise<Result<void, AppError>> {
    const document = await this.deps.documents.findById(documentId);
    if (!document) return err(new NotFoundError("Documento", documentId));

    document.requeue(this.deps.clock.now());

    await this.deps.unitOfWork.run(async () => {
      await this.deps.documents.save(document);
      await this.deps.events.publish(DocumentIngested, {
        documentId: document.id,
        collectionId: document.collectionId,
        title: document.title,
        version: document.version,
      });
    });

    return okVoid();
  }
}

/**
 * `DeleteDocument` — borra fragmentos, fila y original.
 *
 * El orden importa: primero los fragmentos, porque son lo que el agente puede
 * citar. Un documento borrado cuyos fragmentos siguen en el índice haría que el
 * agente citara una fuente que ya no existe, y eso es peor que no responder.
 */
export class DeleteDocumentUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(documentId: string): Promise<Result<void, AppError>> {
    const document = await this.deps.documents.findById(documentId);
    if (!document) return err(new NotFoundError("Documento", documentId));

    await this.deps.unitOfWork.run(async () => {
      await this.deps.chunks.deleteByDocument(documentId);
      await this.deps.documents.delete(documentId);
    });

    const ref = document.sourceRef;
    if (ref !== undefined) {
      // El archivo se borra DESPUÉS del commit: si fallara, queda un huérfano
      // en disco, que es infinitamente mejor que una fila que apunta a la nada.
      const removed = await this.deps.storage.delete(ref);
      if (isErr(removed)) {
        this.deps.logger.warn("Documento borrado pero su original sigue en disco", {
          documentId,
          ref,
        });
      }
    }

    return okVoid();
  }
}
