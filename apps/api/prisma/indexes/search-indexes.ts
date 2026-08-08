/**
 * Índices que Prisma no sabe modelar, y que por eso hay que vigilar.
 *
 * **Existe porque ya se perdieron una vez.** `prisma migrate dev` compara el
 * modelo con la base y trata como deriva todo lo que no conoce: al generar la
 * migración de F7 dejó caer el HNSW y el GIN de `document_chunks`, creados con
 * SQL crudo en F5. Nadie lo pidió y nada falló — las búsquedas siguieron dando
 * resultados correctos, solo que recorriendo la tabla entera. Sobrevivió tres
 * fases hasta que la verificación de copias lo delató.
 *
 * La lista vive en TypeScript, como la de RLS, para que un test la compare con
 * lo que hay de verdad en Postgres. Es la única defensa posible para el HNSW:
 * el lenguaje de esquema de Prisma no tiene ese tipo de índice, así que no se
 * puede declarar y volvería a caer a la primera. El GIN sí está declarado en
 * `knowledge.prisma` y además está aquí: cinturón y tirantes para lo que ya
 * demostró que se pierde en silencio.
 */

export interface SearchIndex {
  readonly name: string;
  readonly table: string;
  /** Método de acceso en `pg_am`: `hnsw`, `gin`, `btree`… */
  readonly method: string;
  /** Qué consulta deja de usar índice si falta. Es lo que hay que poder medir. */
  readonly protects: string;
  /** DDL idempotente. Una sola fuente de verdad para crearlo y para repararlo. */
  readonly createSql: string;
}

export const SEARCH_INDEXES: readonly SearchIndex[] = [
  {
    name: "document_chunks_embedding_idx",
    table: "document_chunks",
    method: "hnsw",
    protects:
      "Carril vectorial: `embedding <=> $1`. Sin él, cada pregunta del cliente " +
      "compara su vector contra TODOS los fragmentos de la base.",
    createSql: `CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx"
                  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)`,
  },
  {
    name: "document_chunks_tsv_idx",
    table: "document_chunks",
    method: "gin",
    protects:
      "Carril léxico: `tsv @@ query`. Sin él, el full-text en español recorre " +
      "la tabla entera en cada búsqueda.",
    createSql: `CREATE INDEX IF NOT EXISTS "document_chunks_tsv_idx"
                  ON "document_chunks" USING GIN ("tsv" tsvector_ops)`,
  },
] as const;
