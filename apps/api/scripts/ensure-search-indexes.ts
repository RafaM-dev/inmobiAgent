import { PrismaClient } from "@prisma/client";
import { SEARCH_INDEXES } from "../prisma/indexes/search-indexes";

/**
 * Recrea los índices de búsqueda que Prisma no sabe modelar.
 *
 * **Corre DESPUÉS de cada migración, y no es una precaución teórica.**
 * `prisma migrate dev` trata como deriva todo lo que su lenguaje de esquema no
 * puede expresar, y el índice HNSW de pgvector es uno de esos casos: no hay
 * forma de declararlo, así que Prisma genera un `DROP INDEX` cada vez que
 * alguien crea una migración. Ya ocurrió una vez y sobrevivió tres fases,
 * porque perder este índice no rompe nada — solo convierte cada búsqueda en un
 * recorrido de la tabla entera.
 *
 * El GIN sí está declarado en `knowledge.prisma` desde la reparación, y por eso
 * Prisma ya no lo toca. Se recrea aquí igualmente: cuesta cero y cubre el día
 * que alguien reordene el modelo.
 *
 * Es idempotente (`IF NOT EXISTS`) y por tanto seguro en producción. Lo caro
 * sería lo contrario: descubrir en un incidente que el índice llevaba semanas
 * sin existir.
 */
export const ensureSearchIndexes = async (databaseUrl: string): Promise<string[]> => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const created: string[] = [];

  try {
    for (const index of SEARCH_INDEXES) {
      const before = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
        "SELECT true AS ok FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
        index.name,
      );
      if (before.length > 0) continue;

      await prisma.$executeRawUnsafe(index.createSql);
      created.push(index.name);
    }
  } finally {
    await prisma.$disconnect();
  }

  return created;
};

/* -------------------------------------------------------------------------- *
 * CLI
 * -------------------------------------------------------------------------- */

const isCli = process.argv[1]?.includes("ensure-search-indexes") ?? false;

if (isCli) {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  ensureSearchIndexes(databaseUrl)
    .then((created) => {
      if (created.length === 0) {
        console.log(`✔ Índices de búsqueda en su sitio (${String(SEARCH_INDEXES.length)}).`);
        return;
      }
      console.log(`✔ Índices de búsqueda recreados: ${created.join(", ")}`);
      console.log("  (los había tirado una migración; revisa el SQL generado antes de subirlo)");
    })
    .catch((error: unknown) => {
      console.error(
        "No se pudieron asegurar los índices de búsqueda:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    });
}
