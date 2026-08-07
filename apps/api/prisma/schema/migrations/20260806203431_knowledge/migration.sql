-- CreateEnum
CREATE TYPE "DocumentSourceType" AS ENUM ('UPLOAD', 'URL', 'TEXT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'INDEXING', 'INDEXED', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_collections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" "DocumentSourceType" NOT NULL,
    "source_ref" TEXT,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "embedding_model" TEXT,
    "failure_reason" TEXT,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "heading" TEXT,
    "tokens" INTEGER NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "embedding" vector(1536),
    "tsv" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_collections_tenant_id_slug_key" ON "knowledge_collections"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "documents_tenant_id_status_idx" ON "documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "documents_tenant_id_collection_id_idx" ON "documents"("tenant_id", "collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenant_id_collection_id_checksum_key" ON "documents"("tenant_id", "collection_id", "checksum");

-- CreateIndex
CREATE INDEX "document_chunks_tenant_id_embedding_model_idx" ON "document_chunks"("tenant_id", "embedding_model");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_ordinal_key" ON "document_chunks"("document_id", "ordinal");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "knowledge_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Búsqueda híbrida: full-text en español sin tildes + vecinos por coseno.
--
-- Estas tres cosas Prisma no las modela, y las tres son el motivo por el que la
-- búsqueda de conocimiento se escribe en SQL crudo.
-- ---------------------------------------------------------------------------

-- `unaccent` NO es IMMUTABLE (depende del diccionario activo), así que Postgres
-- no la admite en una columna generada ni en un índice. Este envoltorio fija el
-- diccionario y por tanto sí lo es. Sin él, "Medellin" no encontraría
-- "Medellín" — y en español eso es la mitad de las búsquedas.
CREATE OR REPLACE FUNCTION f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- El tsvector lo calcula la base, no la aplicación: así no puede quedarse
-- desincronizado del contenido pase lo que pase. Incluye el epígrafe porque es
-- lo que da contexto al fragmento, igual que al vectorizarlo.
ALTER TABLE "document_chunks" DROP COLUMN "tsv";
ALTER TABLE "document_chunks"
  ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish', f_unaccent(coalesce("heading", '') || ' ' || "content"))
  ) STORED;

CREATE INDEX "document_chunks_tsv_idx" ON "document_chunks" USING GIN ("tsv");

-- HNSW sobre distancia coseno: es lo que evita que `<=>` recorra la tabla
-- entera. El operador del índice y el de la consulta DEBEN coincidir.
CREATE INDEX "document_chunks_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
