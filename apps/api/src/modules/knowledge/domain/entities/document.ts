import { DomainError } from "../../../../platform/errors/app-error";

/**
 * De dónde salió el documento. `URL` está declarado pero no implementado en F5
 * (decisión D26): bajar una página y convertirla en texto útil es un problema
 * propio —redirecciones, HTML, paginación— y una ingesta que produce basura en
 * silencio es peor que una que dice que no puede.
 */
export const DocumentSourceType = {
  UPLOAD: "UPLOAD",
  URL: "URL",
  TEXT: "TEXT",
} as const;
export type DocumentSourceType = (typeof DocumentSourceType)[keyof typeof DocumentSourceType];

export const DocumentStatus = {
  /** Guardado, pendiente de indexar. */
  PENDING: "PENDING",
  INDEXING: "INDEXING",
  INDEXED: "INDEXED",
  FAILED: "FAILED",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

const TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  PENDING: ["INDEXING", "FAILED"],
  INDEXING: ["INDEXED", "FAILED"],
  // Reindexar es volver a empezar: un documento indexado o fallido puede
  // reprocesarse, y eso es exactamente lo que hace falta al cambiar de
  // proveedor de embeddings.
  INDEXED: ["PENDING", "FAILED"],
  FAILED: ["PENDING"],
};

export interface DocumentProps {
  readonly id: string;
  readonly tenantId: string;
  readonly collectionId: string;
  readonly title: string;
  readonly sourceType: DocumentSourceType;
  /** Ruta en `FileStorage` o URL de origen. Opaca para el dominio. */
  readonly sourceRef?: string;
  readonly mimeType: string;
  /** SHA-256 del contenido extraído. Es la clave de idempotencia. */
  readonly checksum: string;
  readonly status: DocumentStatus;
  /** Sube en cada reindexado. Permite distinguir fragmentos viejos de nuevos. */
  readonly version: number;
  readonly chunkCount: number;
  /** Modelo con el que se generaron los vectores actuales. */
  readonly embeddingModel?: string;
  readonly failureReason?: string;
  readonly indexedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * AGREGADO `Document` — un documento de la inmobiliaria.
 *
 * El documento NO guarda su texto: guarda de dónde vino, su huella y su estado.
 * El texto vive troceado en `DocumentChunk`, que es la unidad que se recupera y
 * se cita. Guardar además el original completo aquí sería una tercera copia que
 * envejece por su cuenta.
 */
export class Document {
  private constructor(private props: DocumentProps) {}

  static create(input: {
    id: string;
    tenantId: string;
    collectionId: string;
    title: string;
    sourceType: DocumentSourceType;
    sourceRef?: string;
    mimeType: string;
    checksum: string;
    now: Date;
  }): Document {
    const title = input.title.trim();
    if (title.length === 0) throw new DomainError("El documento necesita un título");

    return new Document({
      id: input.id,
      tenantId: input.tenantId,
      collectionId: input.collectionId,
      title,
      sourceType: input.sourceType,
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      mimeType: input.mimeType,
      checksum: input.checksum,
      status: DocumentStatus.PENDING,
      version: 1,
      chunkCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: DocumentProps): Document {
    return new Document(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get collectionId(): string {
    return this.props.collectionId;
  }
  get title(): string {
    return this.props.title;
  }
  get checksum(): string {
    return this.props.checksum;
  }
  get status(): DocumentStatus {
    return this.props.status;
  }
  get version(): number {
    return this.props.version;
  }
  get chunkCount(): number {
    return this.props.chunkCount;
  }
  get embeddingModel(): string | undefined {
    return this.props.embeddingModel;
  }
  get sourceRef(): string | undefined {
    return this.props.sourceRef;
  }
  get mimeType(): string {
    return this.props.mimeType;
  }
  get isIndexed(): boolean {
    return this.props.status === DocumentStatus.INDEXED;
  }

  startIndexing(now: Date): void {
    this.transition(DocumentStatus.INDEXING, now);
  }

  /**
   * Indexado terminado. Guarda CON QUÉ MODELO se generaron los vectores: sin
   * ese dato no hay forma de saber que una búsqueda está comparando vectores de
   * dos espacios distintos, que es un fallo silencioso y devastador.
   */
  markIndexed(input: { chunkCount: number; embeddingModel: string; now: Date }): void {
    this.transition(DocumentStatus.INDEXED, input.now);
    this.props = {
      ...this.props,
      chunkCount: input.chunkCount,
      embeddingModel: input.embeddingModel,
      indexedAt: input.now,
    };
  }

  markFailed(reason: string, now: Date): void {
    this.transition(DocumentStatus.FAILED, now);
    this.props = { ...this.props, failureReason: reason };
  }

  /** Vuelve a la cola. Sube la versión: los fragmentos viejos son descartables. */
  requeue(now: Date): void {
    this.transition(DocumentStatus.PENDING, now);
    const { failureReason: _previous, ...rest } = this.props;
    this.props = { ...rest, version: this.props.version + 1, chunkCount: 0 };
  }

  snapshot(): DocumentProps {
    return { ...this.props };
  }

  private transition(next: DocumentStatus, now: Date): void {
    if (this.props.status === next) return;

    if (!TRANSITIONS[this.props.status].includes(next)) {
      throw new DomainError(`Un documento no puede pasar de ${this.props.status} a ${next}`, {
        documentId: this.props.id,
        from: this.props.status,
        to: next,
      });
    }
    this.props = { ...this.props, status: next, updatedAt: now };
  }
}
