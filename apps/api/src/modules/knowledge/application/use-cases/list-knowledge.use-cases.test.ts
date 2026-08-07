import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../../platform/result/result";
import { Document, DocumentSourceType } from "../../domain/entities/document";
import { KnowledgeCollection } from "../../domain/entities/knowledge-collection";
import {
  InMemoryCollectionRepository,
  InMemoryDocumentRepository,
} from "../../testing/in-memory-knowledge.repositories";
import { ListCollectionsUseCase, ListDocumentsUseCase } from "./list-knowledge.use-cases";

const NOW = new Date("2026-03-01T12:00:00.000Z");

const setup = async () => {
  const collections = new InMemoryCollectionRepository();
  const documents = new InMemoryDocumentRepository();

  const collection = KnowledgeCollection.create({
    id: "col-1",
    tenantId: "tenant-1",
    name: "Políticas",
    description: "Cómo trabaja la inmobiliaria",
    now: NOW,
  });
  await collections.save(collection);

  const document = Document.create({
    id: "doc-1",
    tenantId: "tenant-1",
    collectionId: "col-1",
    title: "Requisitos para arrendar",
    sourceType: DocumentSourceType.TEXT,
    mimeType: "text/plain",
    checksum: "abc",
    now: NOW,
  });

  return {
    collections,
    documents,
    document,
    listCollections: new ListCollectionsUseCase({ collections, documents }),
    listDocuments: new ListDocumentsUseCase({ collections, documents }),
  };
};

describe("ListCollectionsUseCase", () => {
  it("devuelve la colección con su descripción", async () => {
    const { listCollections } = await setup();

    const result = await listCollections.execute();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe("Políticas");
    expect(result.value[0]?.description).toBe("Cómo trabaja la inmobiliaria");
  });

  it("cuenta los documentos de verdad en vez de leer un contador guardado", async () => {
    const { listCollections, documents, document } = await setup();

    const before = await listCollections.execute();
    if (isOk(before)) expect(before.value[0]?.documentCount).toBe(0);

    await documents.save(document);

    const after = await listCollections.execute();
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value[0]?.documentCount).toBe(1);
  });
});

describe("ListDocumentsUseCase", () => {
  it("distingue una colección vacía de una que no existe", async () => {
    const { listDocuments } = await setup();

    const empty = await listDocuments.execute({ collectionId: "col-1" });
    expect(isOk(empty)).toBe(true);
    if (isOk(empty)) expect(empty.value).toHaveLength(0);

    /*
     * "Vacío" y "no existe" son respuestas distintas. Si una colección de otra
     * inmobiliaria devolviera una lista vacía, el asesor pensaría que sus
     * documentos desaparecieron en vez de que se equivocó de sitio.
     */
    const missing = await listDocuments.execute({ collectionId: "col-de-otro" });
    expect(isErr(missing)).toBe(true);
  });

  it("publica el estado de indexado, incluido el motivo del fallo", async () => {
    const { listDocuments, documents, document } = await setup();

    document.startIndexing(NOW);
    document.markFailed("El archivo no tiene texto legible", NOW);
    await documents.save(document);

    const result = await listDocuments.execute({ collectionId: "col-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Un documento subido pero no indexado es invisible para el agente: quien
    // lo subió tiene que poder verlo, o culpará a la IA de no saber algo que
    // cree haberle enseñado.
    expect(result.value[0]?.status).toBe("FAILED");
    expect(result.value[0]?.failureReason).toBe("El archivo no tiene texto legible");
    expect(result.value[0]?.chunkCount).toBe(0);
  });

  it("expone con qué modelo se vectorizó cada documento", async () => {
    const { listDocuments, documents, document } = await setup();

    document.startIndexing(NOW);
    document.markIndexed({ chunkCount: 4, embeddingModel: "mock-hashing-v1", now: NOW });
    await documents.save(document);

    const result = await listDocuments.execute({ collectionId: "col-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Sin este dato no hay forma de saber que una búsqueda está comparando
    // vectores de dos espacios distintos (D25).
    expect(result.value[0]?.embeddingModel).toBe("mock-hashing-v1");
    expect(result.value[0]?.chunkCount).toBe(4);
  });
});
