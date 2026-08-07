import { Document } from "../domain/entities/document";
import { KnowledgeCollection } from "../domain/entities/knowledge-collection";
import type {
  ChunkMatch,
  ChunkSearchQuery,
  DocumentChunkRepository,
  DocumentRepository,
  IndexedChunk,
  KnowledgeCollectionRepository,
} from "../domain/repositories/knowledge.repositories";
import { cosineSimilarity } from "../application/ports/embedding-provider";
import { toTerms } from "../domain/value-objects/spanish-terms";

/**
 * Dobles en memoria de la persistencia de conocimiento.
 *
 * El de fragmentos reproduce los DOS carriles de la búsqueda real: coseno sobre
 * los vectores y coincidencia de términos. No es Postgres —no hay HNSW ni
 * `ts_rank`— pero mantiene la propiedad que importa para probar la fusión: cada
 * carril devuelve un orden distinto, y solo uno de ellos exige que las palabras
 * aparezcan de verdad.
 */

export class InMemoryCollectionRepository implements KnowledgeCollectionRepository {
  private readonly rows = new Map<string, ReturnType<KnowledgeCollection["snapshot"]>>();

  findById(id: string): Promise<KnowledgeCollection | null> {
    const found = this.rows.get(id);
    return Promise.resolve(found ? KnowledgeCollection.rehydrate({ ...found }) : null);
  }

  findBySlug(slug: string): Promise<KnowledgeCollection | null> {
    const found = [...this.rows.values()].find((props) => props.slug === slug);
    return Promise.resolve(found ? KnowledgeCollection.rehydrate({ ...found }) : null);
  }

  save(collection: KnowledgeCollection): Promise<void> {
    this.rows.set(collection.id, collection.snapshot());
    return Promise.resolve();
  }

  list(): Promise<KnowledgeCollection[]> {
    return Promise.resolve(
      [...this.rows.values()].map((props) => KnowledgeCollection.rehydrate({ ...props })),
    );
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly rows = new Map<string, ReturnType<Document["snapshot"]>>();

  findById(id: string): Promise<Document | null> {
    const found = this.rows.get(id);
    return Promise.resolve(found ? Document.rehydrate({ ...found }) : null);
  }

  findByChecksum(collectionId: string, checksum: string): Promise<Document | null> {
    const found = [...this.rows.values()].find(
      (props) => props.collectionId === collectionId && props.checksum === checksum,
    );
    return Promise.resolve(found ? Document.rehydrate({ ...found }) : null);
  }

  save(document: Document): Promise<void> {
    this.rows.set(document.id, document.snapshot());
    return Promise.resolve();
  }

  listByCollection(collectionId: string, limit: number): Promise<Document[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((props) => props.collectionId === collectionId)
        .slice(0, limit)
        .map((props) => Document.rehydrate({ ...props })),
    );
  }

  countByCollection(collectionIds: readonly string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const id of collectionIds) counts[id] = 0;
    for (const props of this.rows.values()) {
      const current = counts[props.collectionId];
      if (current !== undefined) counts[props.collectionId] = current + 1;
    }
    return Promise.resolve(counts);
  }

  listPending(limit: number): Promise<Document[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((props) => props.status === "PENDING" || props.status === "INDEXING")
        .slice(0, limit)
        .map((props) => Document.rehydrate({ ...props })),
    );
  }

  delete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

interface StoredChunk extends IndexedChunk {
  readonly id: string;
  readonly documentId: string;
  readonly embeddingModel: string;
}

/** La misma normalización que en producción: sin tildes y sin palabras vacías. */
const terms = toTerms;

export class InMemoryChunkRepository implements DocumentChunkRepository {
  private readonly chunks = new Map<string, StoredChunk[]>();
  /** Metadatos que en la base salen del JOIN con documentos y colecciones. */
  private readonly documents = new Map<
    string,
    { title: string; collectionId: string; collectionName: string }
  >();

  registerDocument(
    documentId: string,
    meta: { title: string; collectionId: string; collectionName: string },
  ): void {
    this.documents.set(documentId, meta);
  }

  replaceAll(input: {
    documentId: string;
    embeddingModel: string;
    chunks: readonly IndexedChunk[];
  }): Promise<void> {
    this.chunks.set(
      input.documentId,
      input.chunks.map((chunk, index) => ({
        ...chunk,
        id: `${input.documentId}-${String(index)}`,
        documentId: input.documentId,
        embeddingModel: input.embeddingModel,
      })),
    );
    return Promise.resolve();
  }

  deleteByDocument(documentId: string): Promise<void> {
    this.chunks.delete(documentId);
    return Promise.resolve();
  }

  searchByVector(query: ChunkSearchQuery): Promise<ChunkMatch[]> {
    const scored = this.candidates(query)
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(query.embedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);

    return Promise.resolve(scored.map(({ chunk, score }) => this.toMatch(chunk, score)));
  }

  searchByText(query: ChunkSearchQuery): Promise<ChunkMatch[]> {
    const wanted = new Set(terms(query.text));

    const scored = this.candidates(query)
      .map((chunk) => {
        const present = terms(`${chunk.heading ?? ""} ${chunk.content}`);
        const hits = present.filter((term) => wanted.has(term)).length;
        return { chunk, score: hits / Math.max(1, wanted.size) };
      })
      // El carril léxico solo devuelve lo que de verdad contiene los términos.
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);

    return Promise.resolve(scored.map(({ chunk, score }) => this.toMatch(chunk, score)));
  }

  private candidates(query: ChunkSearchQuery): StoredChunk[] {
    return [...this.chunks.values()].flat().filter((chunk) => {
      if (chunk.embeddingModel !== query.embeddingModel) return false;
      if (!query.collectionIds || query.collectionIds.length === 0) return true;
      const meta = this.documents.get(chunk.documentId);
      return meta !== undefined && query.collectionIds.includes(meta.collectionId);
    });
  }

  private toMatch(chunk: StoredChunk, score: number): ChunkMatch {
    const meta = this.documents.get(chunk.documentId);
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      collectionId: meta?.collectionId ?? "",
      ordinal: chunk.ordinal,
      content: chunk.content,
      ...(chunk.heading !== undefined ? { heading: chunk.heading } : {}),
      documentTitle: meta?.title ?? "Documento",
      collectionName: meta?.collectionName ?? "General",
      rawScore: score,
    };
  }
}
