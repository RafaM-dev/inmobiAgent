import type { Document } from "../entities/document";
import type { KnowledgeCollection } from "../entities/knowledge-collection";

export interface KnowledgeCollectionRepository {
  findById(id: string): Promise<KnowledgeCollection | null>;
  findBySlug(slug: string): Promise<KnowledgeCollection | null>;
  save(collection: KnowledgeCollection): Promise<void>;
  list(): Promise<KnowledgeCollection[]>;
}

export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  /**
   * Idempotencia de la ingesta: el mismo contenido en la misma colección es el
   * mismo documento. Subir dos veces el reglamento no crea dos reglamentos ni
   * duplica sus fragmentos en la búsqueda.
   */
  findByChecksum(collectionId: string, checksum: string): Promise<Document | null>;
  save(document: Document): Promise<void>;
  listByCollection(collectionId: string, limit: number): Promise<Document[]>;
  /**
   * Cuántos documentos tiene cada colección.
   *
   * Se CUENTA, no se guarda un contador en la colección. Un contador
   * denormalizado se desincroniza en cuanto un borrado falla a medias, y el
   * síntoma —"Políticas (7)" con cuatro documentos dentro— hace dudar de todo
   * lo demás que muestra la pantalla.
   */
  countByCollection(collectionIds: readonly string[]): Promise<Record<string, number>>;
  /** Documentos que se quedaron a medias. Los recoge el arranque tras una caída. */
  listPending(limit: number): Promise<Document[]>;
  delete(id: string): Promise<void>;
}

/** Un fragmento listo para escribir, con su vector ya calculado. */
export interface IndexedChunk {
  readonly ordinal: number;
  readonly content: string;
  readonly tokens: number;
  readonly heading?: string;
  readonly embedding: readonly number[];
}

/** Un fragmento recuperado por uno de los dos carriles de búsqueda. */
export interface ChunkMatch {
  readonly chunkId: string;
  readonly documentId: string;
  readonly collectionId: string;
  readonly ordinal: number;
  readonly content: string;
  readonly heading?: string;
  readonly documentTitle: string;
  readonly collectionName: string;
  /**
   * Puntuación cruda del carril que lo encontró. Solo sirve para ordenar DENTRO
   * de su carril: la distancia coseno y el `ts_rank` de Postgres no son
   * comparables entre sí, y por eso la fusión usa posiciones y no valores.
   */
  readonly rawScore: number;
}

export interface ChunkSearchQuery {
  /** Texto de la pregunta, ya normalizado por quien llama. */
  readonly text: string;
  readonly embedding: readonly number[];
  /**
   * Solo se comparan fragmentos vectorizados con ESTE modelo. Mezclar espacios
   * vectoriales no da malos resultados: da resultados sin sentido (D25).
   */
  readonly embeddingModel: string;
  readonly collectionIds?: readonly string[];
  readonly limit: number;
}

export interface DocumentChunkRepository {
  /** Sustituye TODOS los fragmentos de un documento. Reindexar es reemplazar. */
  replaceAll(input: {
    documentId: string;
    embeddingModel: string;
    chunks: readonly IndexedChunk[];
  }): Promise<void>;
  deleteByDocument(documentId: string): Promise<void>;
  /** Carril semántico: vecinos más próximos por coseno. */
  searchByVector(query: ChunkSearchQuery): Promise<ChunkMatch[]>;
  /** Carril léxico: full-text en español, insensible a tildes. */
  searchByText(query: ChunkSearchQuery): Promise<ChunkMatch[]>;
}
