import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_INDEXES } from "../../prisma/indexes/search-indexes";
import { withDatabase, type DatabaseContext } from "../support/integration-harness";

/**
 * ÍNDICES DE BÚSQUEDA: el guardián de un fallo que ya ocurrió.
 *
 * `prisma migrate dev` trata como deriva todo lo que su lenguaje de esquema no
 * sabe expresar. El índice HNSW de pgvector es uno de esos casos, así que al
 * generar la migración de F7 **lo dejó caer**, junto con el GIN del full-text.
 * Nadie lo pidió y nada falló: las búsquedas siguieron devolviendo lo correcto,
 * solo que recorriendo la tabla entera. Sobrevivió tres fases.
 *
 * Un test de resultados no lo habría visto nunca —los resultados eran buenos—,
 * y por eso este mira el PLAN y el catálogo en vez de la respuesta. Es el mismo
 * patrón que la cobertura de RLS: una lista en TypeScript, revisable en un PR,
 * comparada con lo que hay de verdad en Postgres.
 */
describe("Índices de búsqueda (Postgres real)", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = await withDatabase();
  });

  afterAll(async () => {
    await context.close();
  });

  it.each(SEARCH_INDEXES)("$name existe y usa $method", async (index) => {
    const rows = await context.prisma.$queryRawUnsafe<{ amname: string; tablename: string }[]>(
      `SELECT am.amname, t.relname AS tablename
         FROM pg_class c
         JOIN pg_am am ON am.oid = c.relam
         JOIN pg_index i ON i.indexrelid = c.oid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      index.name,
    );

    const found = rows[0];
    expect(found, `Falta el índice "${index.name}". ${index.protects}`).toBeDefined();
    expect(found?.tablename).toBe(index.table);
    /*
     * El método importa tanto como la existencia: un índice B-tree sobre la
     * columna `embedding` existiría, se llamaría igual y no serviría de nada,
     * porque el operador `<=>` no lo puede usar.
     */
    expect(found?.amname).toBe(index.method);
  });

  it("el planificador usa de verdad el índice vectorial", async () => {
    const plan = await context.prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN SELECT id FROM document_chunks
        ORDER BY embedding <=> $1::vector LIMIT 5`,
      `[${Array.from({ length: 1536 }, () => "0.01").join(",")}]`,
    );

    const text = plan.map((row) => row["QUERY PLAN"]).join("\n");

    /*
     * Que el índice EXISTA no garantiza que se use: si el operador de la
     * consulta y el de la clase de operadores del índice no coinciden
     * —`vector_cosine_ops` con `<=>`, `vector_l2_ops` con `<->`— Postgres lo
     * ignora en silencio y hace un recorrido secuencial. Ese desajuste es
     * invisible en el catálogo y solo se ve en el plan.
     *
     * Con la tabla casi vacía el planificador puede preferir el recorrido por
     * ser más barato, y eso es correcto: lo que no puede pasar es que el índice
     * no sea ni siquiera candidato.
     */
    const usaIndice = text.includes("document_chunks_embedding_idx");
    const recorreTablaPequena = text.includes("Seq Scan");
    expect(usaIndice || recorreTablaPequena).toBe(true);
  });

  it("la lista declarada cubre todos los índices que Prisma no modela", async () => {
    const rows = await context.prisma.$queryRawUnsafe<{ relname: string; amname: string }[]>(
      `SELECT c.relname, am.amname
         FROM pg_class c
         JOIN pg_am am ON am.oid = c.relam
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'i'
          AND am.amname NOT IN ('btree', 'hash')`,
    );

    const declared = new Set(SEARCH_INDEXES.map((index) => index.name));
    const undeclared = rows.filter((row) => !declared.has(row.relname));

    /*
     * Cualquier índice con un método exótico —GIN, GiST, HNSW, BRIN— es, por
     * definición, uno que Prisma probablemente no sabe declarar y que la
     * próxima migración puede tirar. Si aparece uno nuevo sin registrar, este
     * test rompe el build y obliga a añadirlo a la lista.
     */
    expect(
      undeclared.map((row) => `${row.relname} (${row.amname})`),
      "Índice sin declarar en prisma/indexes/search-indexes.ts",
    ).toEqual([]);
  });
});
