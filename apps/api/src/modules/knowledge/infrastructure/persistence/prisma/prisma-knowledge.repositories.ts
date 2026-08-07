import { Prisma } from "../../../../../generated/prisma/client";
import type {
  Document as PrismaDocument,
  KnowledgeCollection as PrismaCollection,
} from "../../../../../generated/prisma/client";
import type { Database } from "../../../../../platform/database/prisma";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import { Document } from "../../../domain/entities/document";
import { KnowledgeCollection } from "../../../domain/entities/knowledge-collection";
import type {
  ChunkMatch,
  ChunkSearchQuery,
  DocumentChunkRepository,
  DocumentRepository,
  IndexedChunk,
  KnowledgeCollectionRepository,
} from "../../../domain/repositories/knowledge.repositories";

/* ========================================================================== *
 * Colecciones
 * ========================================================================== */

const toCollection = (row: PrismaCollection): KnowledgeCollection =>
  KnowledgeCollection.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    slug: row.slug,
    ...(row.description !== null ? { description: row.description } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaKnowledgeCollectionRepository implements KnowledgeCollectionRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<KnowledgeCollection | null> {
    const row = await this.db.client().knowledgeCollection.findFirst({
      where: { ...tenantScope(), id },
    });
    return row ? toCollection(row) : null;
  }

  async findBySlug(slug: string): Promise<KnowledgeCollection | null> {
    const row = await this.db.client().knowledgeCollection.findUnique({
      where: { tenantId_slug: { ...tenantScope(), slug } },
    });
    return row ? toCollection(row) : null;
  }

  async save(collection: KnowledgeCollection): Promise<void> {
    const data = collection.snapshot();
    assertWritableTenant(data.tenantId, "colección");

    await this.db.client().knowledgeCollection.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      update: {
        name: data.name,
        description: data.description ?? null,
        updatedAt: data.updatedAt,
      },
    });
  }

  async list(): Promise<KnowledgeCollection[]> {
    const rows = await this.db.client().knowledgeCollection.findMany({
      where: tenantScope(),
      orderBy: { name: "asc" },
    });
    return rows.map(toCollection);
  }
}

/* ========================================================================== *
 * Documentos
 * ========================================================================== */

const toDocument = (row: PrismaDocument): Document =>
  Document.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    collectionId: row.collectionId,
    title: row.title,
    sourceType: row.sourceType,
    ...(row.sourceRef !== null ? { sourceRef: row.sourceRef } : {}),
    mimeType: row.mimeType,
    checksum: row.checksum,
    status: row.status,
    version: row.version,
    chunkCount: row.chunkCount,
    ...(row.embeddingModel !== null ? { embeddingModel: row.embeddingModel } : {}),
    ...(row.failureReason !== null ? { failureReason: row.failureReason } : {}),
    ...(row.indexedAt !== null ? { indexedAt: row.indexedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Document | null> {
    const row = await this.db.client().document.findFirst({ where: { ...tenantScope(), id } });
    return row ? toDocument(row) : null;
  }

  async findByChecksum(collectionId: string, checksum: string): Promise<Document | null> {
    const row = await this.db.client().document.findUnique({
      where: {
        tenantId_collectionId_checksum: { ...tenantScope(), collectionId, checksum },
      },
    });
    return row ? toDocument(row) : null;
  }

  async save(document: Document): Promise<void> {
    const data = document.snapshot();
    assertWritableTenant(data.tenantId, "documento");

    const persistable = {
      title: data.title,
      sourceRef: data.sourceRef ?? null,
      mimeType: data.mimeType,
      status: data.status,
      version: data.version,
      chunkCount: data.chunkCount,
      embeddingModel: data.embeddingModel ?? null,
      failureReason: data.failureReason ?? null,
      indexedAt: data.indexedAt ?? null,
      updatedAt: data.updatedAt,
    };

    await this.db.client().document.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        collectionId: data.collectionId,
        sourceType: data.sourceType,
        checksum: data.checksum,
        createdAt: data.createdAt,
        ...persistable,
      },
      update: persistable,
    });
  }

  async listByCollection(collectionId: string, limit: number): Promise<Document[]> {
    const rows = await this.db.client().document.findMany({
      where: { ...tenantScope(), collectionId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toDocument);
  }

  async countByCollection(collectionIds: readonly string[]): Promise<Record<string, number>> {
    if (collectionIds.length === 0) return {};

    // Un solo `GROUP BY` para todas las colecciones: contar una por una sería
    // una consulta por fila de la pantalla.
    const rows = await this.db.client().document.groupBy({
      by: ["collectionId"],
      where: { ...tenantScope(), collectionId: { in: [...collectionIds] } },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const id of collectionIds) counts[id] = 0;
    for (const row of rows) counts[row.collectionId] = row._count._all;
    return counts;
  }

  async listPending(limit: number): Promise<Document[]> {
    const rows = await this.db.client().document.findMany({
      where: { ...tenantScope(), status: { in: ["PENDING", "INDEXING"] } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map(toDocument);
  }

  async delete(id: string): Promise<void> {
    await this.db.client().document.deleteMany({ where: { ...tenantScope(), id } });
  }
}

/* ========================================================================== *
 * Fragmentos: pgvector y full-text
 * ========================================================================== */

/** Vector → literal de pgvector: `[0.1,0.2,…]`. */
const toVectorLiteral = (embedding: readonly number[]): string => `[${embedding.join(",")}]`;

interface MatchRow {
  id: string;
  document_id: string;
  collection_id: string;
  ordinal: number;
  content: string;
  heading: string | null;
  document_title: string;
  collection_name: string;
  score: number;
}

const toMatch = (row: MatchRow): ChunkMatch => ({
  chunkId: row.id,
  documentId: row.document_id,
  collectionId: row.collection_id,
  ordinal: row.ordinal,
  content: row.content,
  ...(row.heading !== null ? { heading: row.heading } : {}),
  documentTitle: row.document_title,
  collectionName: row.collection_name,
  rawScore: row.score,
});

/**
 * Repositorio de fragmentos.
 *
 * Es el único del sistema escrito en SQL crudo, y no por gusto: Prisma no
 * modela `vector` ni `tsvector`, y el operador de distancia coseno (`<=>`) es
 * lo que permite que Postgres use el índice HNSW. Escribirlo con el ORM
 * significaría traerse los vectores a memoria y ordenarlos en Node, que es
 * exactamente lo que un índice vectorial existe para evitar.
 */
export class PrismaDocumentChunkRepository implements DocumentChunkRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async replaceAll(input: {
    documentId: string;
    embeddingModel: string;
    chunks: readonly IndexedChunk[];
  }): Promise<void> {
    const { tenantId } = tenantScope();
    const client = this.db.client();

    // Reindexar es REEMPLAZAR. Borrar primero es lo que hace que entregar el
    // evento dos veces produzca el mismo índice y no el doble de fragmentos.
    await client.documentChunk.deleteMany({ where: { tenantId, documentId: input.documentId } });

    for (const chunk of input.chunks) {
      /*
       * El `tsv` se calcula AQUÍ, en el INSERT, con la misma expresión que
       * usaba la columna generada. Sigue siendo Postgres quien lo computa —no
       * la aplicación—, así que la normalización del español y el borrado de
       * tildes son exactamente los mismos que usa la consulta.
       *
       * Dejó de ser columna generada porque Prisma no sabe modelarlas y
       * bloqueaba cualquier migración posterior (ver la migración
       * `channel_deliveries`).
       */
      await client.$executeRaw`
        INSERT INTO document_chunks
          (id, tenant_id, document_id, ordinal, content, heading, tokens, embedding_model, embedding, tsv, created_at)
        VALUES (
          ${this.ids.generate()},
          ${tenantId},
          ${input.documentId},
          ${chunk.ordinal},
          ${chunk.content},
          ${chunk.heading ?? null},
          ${chunk.tokens},
          ${input.embeddingModel},
          ${toVectorLiteral(chunk.embedding)}::vector,
          to_tsvector('spanish', f_unaccent(${`${chunk.heading ?? ""} ${chunk.content}`})),
          NOW()
        )`;
    }
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.db
      .client()
      .documentChunk.deleteMany({ where: { ...tenantScope(), documentId } });
  }

  /** Carril semántico: vecinos más próximos por coseno, con índice HNSW. */
  async searchByVector(query: ChunkSearchQuery): Promise<ChunkMatch[]> {
    const { tenantId } = tenantScope();
    const vector = toVectorLiteral(query.embedding);

    const rows = await this.db.client().$queryRaw<MatchRow[]>`
      SELECT c.id,
             c.document_id,
             d.collection_id,
             c.ordinal,
             c.content,
             c.heading,
             d.title       AS document_title,
             k.name        AS collection_name,
             1 - (c.embedding <=> ${vector}::vector) AS score
      FROM document_chunks c
      JOIN documents d             ON d.id = c.document_id
      JOIN knowledge_collections k ON k.id = d.collection_id
      WHERE c.tenant_id = ${tenantId}
        AND c.embedding_model = ${query.embeddingModel}
        AND c.embedding IS NOT NULL
        AND d.status = 'INDEXED'
        ${this.collectionFilter(query.collectionIds)}
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${query.limit}`;

    return rows.map(toMatch);
  }

  /**
   * Carril léxico: full-text en español e insensible a tildes.
   *
   * La consulta se construye con OR entre términos, NO con `plainto_tsquery`.
   * Ése los une con AND, y en una pregunta real eso no encuentra nada: "¿qué
   * documentos necesito?" exigiría que el párrafo contuviera además la palabra
   * "necesito". Aquí se pasa el texto por `to_tsvector` —que ya normaliza,
   * lematiza y descarta palabras vacías— y se unen los lexemas resultantes con
   * `|`. El orden lo pone `ts_rank`, que premia a los fragmentos con más
   * términos coincidentes.
   *
   * Pasar por `to_tsvector` es además lo que hace segura la construcción: al
   * `to_tsquery` solo llegan lexemas ya normalizados por Postgres, nunca texto
   * del usuario.
   */
  async searchByText(query: ChunkSearchQuery): Promise<ChunkMatch[]> {
    const { tenantId } = tenantScope();

    const rows = await this.db.client().$queryRaw<MatchRow[]>`
      WITH terms AS (
        SELECT array_to_string(
                 tsvector_to_array(to_tsvector('spanish', f_unaccent(${query.text}))),
                 ' | '
               ) AS expression
      ),
      q AS (
        SELECT to_tsquery('spanish', expression) AS query
        FROM terms
        WHERE expression <> ''
      )
      SELECT c.id,
             c.document_id,
             d.collection_id,
             c.ordinal,
             c.content,
             c.heading,
             d.title AS document_title,
             k.name  AS collection_name,
             ts_rank(c.tsv, q.query) AS score
      FROM document_chunks c
      JOIN documents d             ON d.id = c.document_id
      JOIN knowledge_collections k ON k.id = d.collection_id
      CROSS JOIN q
      WHERE c.tenant_id = ${tenantId}
        AND d.status = 'INDEXED'
        AND c.tsv @@ q.query
        ${this.collectionFilter(query.collectionIds)}
      ORDER BY score DESC
      LIMIT ${query.limit}`;

    return rows.map(toMatch);
  }

  /** Filtro opcional por colección, como fragmento parametrizado. */
  private collectionFilter(collectionIds: readonly string[] | undefined): Prisma.Sql {
    if (!collectionIds || collectionIds.length === 0) return Prisma.empty;
    return Prisma.sql`AND d.collection_id IN (${Prisma.join(collectionIds)})`;
  }
}
