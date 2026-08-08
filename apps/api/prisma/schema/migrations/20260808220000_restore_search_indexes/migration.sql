-- ============================================================================
-- REPARACIÓN: los dos índices de búsqueda habían desaparecido.
--
-- Qué pasó. `prisma migrate dev` compara el modelo con la base y trata como
-- "deriva" todo lo que no sabe modelar. Los índices HNSW y GIN se creaban con
-- SQL crudo en la migración de F5, así que Prisma no los conocía: al generar la
-- migración de sesiones de F7 (20260807022638_auth_sessions) los DEJÓ CAER, sin
-- que nadie lo pidiera y sin que nada fallara.
--
-- Por qué sobrevivió tres fases. Porque no rompe nada: los resultados siguen
-- siendo correctos. Lo único que cambia es el plan de ejecución —de índice a
-- recorrido secuencial de `document_chunks`— y con la base de pruebas eso no se
-- nota. Con el reglamento de una inmobiliaria de verdad, cada pregunta del
-- cliente recorre la tabla entera.
--
-- Lo encontró `pnpm db:verify-restore` en su primera ejecución, comprobando la
-- base restaurada... y delatando de paso a la de origen.
--
-- Cómo se evita que vuelva a pasar:
--   · El GIN ya está DECLARADO en `knowledge.prisma`, así que Prisma lo conoce
--     y no puede volver a tirarlo.
--   · El HNSW no se puede declarar: el lenguaje de esquema de Prisma no tiene
--     ese tipo de índice. Lo guarda un test de integración que compara
--     `prisma/indexes/search-indexes.ts` con lo que hay en Postgres, igual que
--     se hace con la cobertura de RLS.
-- ============================================================================

-- Léxico: `tsv @@ query` sin esto es un recorrido secuencial.
CREATE INDEX IF NOT EXISTS "document_chunks_tsv_idx"
  ON "document_chunks" USING GIN ("tsv" tsvector_ops);

-- Vectorial: HNSW sobre distancia coseno. El operador del índice y el de la
-- consulta (`<=>`) DEBEN coincidir, o el índice no se usa aunque exista.
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
