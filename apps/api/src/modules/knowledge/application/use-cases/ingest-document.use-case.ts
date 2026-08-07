import { createHash } from "node:crypto";
import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { FileStorage } from "../../../../platform/storage/file-storage";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { Document, DocumentSourceType, type DocumentStatus } from "../../domain/entities/document";
import type {
  DocumentRepository,
  KnowledgeCollectionRepository,
} from "../../domain/repositories/knowledge.repositories";
import { DocumentIngested } from "../events/knowledge.events";
import type { ExtractorRegistry } from "../services/extractor-registry";

export interface IngestDocumentCommand {
  /** Colección destino, por id o por slug. Uno de los dos. */
  readonly collectionId?: string;
  readonly collectionSlug?: string;
  readonly title?: string;
  readonly sourceType: DocumentSourceType;
  readonly mimeType: string;
  /** Contenido del archivo en UTF-8, o el texto pegado. */
  readonly content: string;
  readonly sourceUrl?: string;
}

export interface IngestedDocumentView {
  readonly documentId: string;
  readonly title: string;
  readonly status: DocumentStatus;
  /** `false` si el mismo contenido ya estaba en esa colección. */
  readonly created: boolean;
}

/**
 * `IngestDocument` — guardar rápido, indexar después.
 *
 * La separación es deliberada: subir un archivo tiene que responder ya, y
 * vectorizarlo puede tardar segundos y puede fallar. Aquí se guarda el
 * original, se crea el documento en `PENDING` y se publica el evento **en la
 * misma transacción**; el indexado es un consumidor que hereda los reintentos
 * del outbox.
 *
 * **Idempotente por contenido**: la huella SHA-256 del texto extraído es la
 * clave. Subir dos veces el mismo reglamento no crea dos reglamentos ni duplica
 * sus fragmentos en la búsqueda — que es como un RAG empieza a contradecirse a
 * sí mismo.
 */
export class IngestDocumentUseCase {
  constructor(
    private readonly deps: {
      collections: KnowledgeCollectionRepository;
      documents: DocumentRepository;
      extractors: ExtractorRegistry;
      storage: FileStorage;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
      maxDocumentBytes: number;
    },
  ) {}

  async execute(
    command: IngestDocumentCommand,
  ): Promise<Result<IngestedDocumentView, AppError>> {
    if (command.sourceType === DocumentSourceType.URL) {
      // Decisión D26: bajar una página y convertirla en texto útil es un
      // problema propio. Antes que ingerir HTML crudo y envenenar el índice,
      // se dice que no.
      return err(
        new ValidationError(
          "Todavía no se pueden ingerir URLs. Pega el texto o sube el archivo.",
        ),
      );
    }

    const bytes = Buffer.byteLength(command.content, "utf8");
    if (bytes > this.deps.maxDocumentBytes) {
      return err(
        new ValidationError(
          `El documento supera el máximo de ${String(
            Math.floor(this.deps.maxDocumentBytes / 1024),
          )} KB.`,
        ),
      );
    }

    const collection = command.collectionId
      ? await this.deps.collections.findById(command.collectionId)
      : await this.deps.collections.findBySlug(command.collectionSlug ?? "");

    if (!collection) {
      return err(new NotFoundError("Colección", command.collectionId ?? command.collectionSlug));
    }

    const extracted = this.deps.extractors.extract({
      content: command.content,
      mimeType: command.mimeType,
    });
    if (isErr(extracted)) return extracted;

    const checksum = createHash("sha256").update(extracted.value.text, "utf8").digest("hex");
    const title = (command.title ?? extracted.value.title ?? "Documento sin título").trim();

    const existing = await this.deps.documents.findByChecksum(collection.id, checksum);
    if (existing) {
      // Mismo contenido, misma colección: es el mismo documento. Si quedó a
      // medias, se reencola; si está bien, no se toca.
      if (existing.status === "FAILED") {
        return this.requeue(existing, collection.id);
      }
      return ok({
        documentId: existing.id,
        title: existing.title,
        status: existing.status,
        created: false,
      });
    }

    const now = this.deps.clock.now();
    const documentId = this.deps.ids.generate();
    const tenantId = TenantContext.requireTenantId();

    /*
     * El original se guarda ANTES de la transacción, a propósito. Si la
     * escritura en base fallara después, quedaría un archivo huérfano —barato
     * de limpiar— en lugar de una fila que apunta a un archivo que no existe,
     * que rompería el reindexado para siempre.
     */
    const stored = await this.deps.storage.put({
      key: `${tenantId}/knowledge/${documentId}`,
      content: Buffer.from(extracted.value.text, "utf8"),
      contentType: command.mimeType,
    });
    if (isErr(stored)) return stored;

    const document = Document.create({
      id: documentId,
      tenantId,
      collectionId: collection.id,
      title,
      sourceType: command.sourceType,
      sourceRef: stored.value.ref,
      mimeType: command.mimeType,
      checksum,
      now,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.documents.save(document);
      await this.deps.events.publish(DocumentIngested, {
        documentId: document.id,
        collectionId: collection.id,
        title: document.title,
        version: document.version,
      });
    });

    return ok({
      documentId: document.id,
      title: document.title,
      status: document.status,
      created: true,
    });
  }

  private async requeue(
    document: Document,
    collectionId: string,
  ): Promise<Result<IngestedDocumentView, AppError>> {
    document.requeue(this.deps.clock.now());

    await this.deps.unitOfWork.run(async () => {
      await this.deps.documents.save(document);
      await this.deps.events.publish(DocumentIngested, {
        documentId: document.id,
        collectionId,
        title: document.title,
        version: document.version,
      });
    });

    return ok({
      documentId: document.id,
      title: document.title,
      status: document.status,
      created: false,
    });
  }
}
