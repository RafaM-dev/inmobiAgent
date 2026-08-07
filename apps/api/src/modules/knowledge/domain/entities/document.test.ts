import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../platform/errors/app-error";
import { Document, DocumentSourceType, DocumentStatus } from "./document";

const NOW = new Date("2026-08-06T15:00:00Z");
const LATER = new Date("2026-08-06T15:05:00Z");

const newDocument = (): Document =>
  Document.create({
    id: "doc-1",
    tenantId: "tenant-1",
    collectionId: "col-1",
    title: "Reglamento de convivencia",
    sourceType: DocumentSourceType.TEXT,
    mimeType: "text/markdown",
    checksum: "abc123",
    now: NOW,
  });

describe("Document — el ciclo de vida de un documento", () => {
  it("nace pendiente de indexar y en versión 1", () => {
    const document = newDocument();

    expect(document.status).toBe(DocumentStatus.PENDING);
    expect(document.version).toBe(1);
    expect(document.chunkCount).toBe(0);
    expect(document.isIndexed).toBe(false);
  });

  it("exige un título", () => {
    expect(() =>
      Document.create({
        id: "doc-2",
        tenantId: "tenant-1",
        collectionId: "col-1",
        title: "   ",
        sourceType: DocumentSourceType.TEXT,
        mimeType: "text/plain",
        checksum: "x",
        now: NOW,
      }),
    ).toThrow(DomainError);
  });

  it("al indexarse guarda con qué modelo se vectorizó", () => {
    const document = newDocument();

    document.startIndexing(NOW);
    document.markIndexed({ chunkCount: 7, embeddingModel: "mock-hashing-v1", now: LATER });

    expect(document.status).toBe(DocumentStatus.INDEXED);
    expect(document.chunkCount).toBe(7);
    // Sin este dato, una búsqueda podría comparar vectores de dos modelos y
    // devolver ruido con aspecto de resultado.
    expect(document.embeddingModel).toBe("mock-hashing-v1");
    expect(document.snapshot().indexedAt).toEqual(LATER);
  });

  it("no se puede indexar sin pasar por indexando", () => {
    const document = newDocument();

    expect(() => {
      document.markIndexed({ chunkCount: 1, embeddingModel: "m", now: NOW });
    }).toThrow(DomainError);
  });

  it("un fallo queda registrado con su motivo", () => {
    const document = newDocument();
    document.startIndexing(NOW);

    document.markFailed("el proveedor de embeddings no respondió", LATER);

    expect(document.status).toBe(DocumentStatus.FAILED);
    expect(document.snapshot().failureReason).toContain("embeddings");
  });

  it("reindexar sube la versión y olvida el fallo anterior", () => {
    const document = newDocument();
    document.startIndexing(NOW);
    document.markFailed("caída del proveedor", NOW);

    document.requeue(LATER);

    expect(document.status).toBe(DocumentStatus.PENDING);
    expect(document.version).toBe(2);
    expect(document.chunkCount).toBe(0);
    expect(document.snapshot().failureReason).toBeUndefined();
  });

  it("un documento ya indexado se puede reencolar: es lo que exige cambiar de modelo", () => {
    const document = newDocument();
    document.startIndexing(NOW);
    document.markIndexed({ chunkCount: 4, embeddingModel: "mock-hashing-v1", now: NOW });

    document.requeue(LATER);

    expect(document.status).toBe(DocumentStatus.PENDING);
    expect(document.version).toBe(2);
  });

  it("repetir el mismo estado no es un error", () => {
    const document = newDocument();
    document.startIndexing(NOW);

    expect(() => {
      document.startIndexing(LATER);
    }).not.toThrow();
  });
});
