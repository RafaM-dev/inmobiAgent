import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { provisionAppRole } from "../../scripts/provision-db-role";

/**
 * Base de datos de los tests de integración.
 *
 * Decisión: **Postgres de verdad, en una base aparte, no Testcontainers.**
 *
 * El proyecto ya levanta Postgres con pgvector por `docker compose`, y las
 * consultas que más falta hace probar —búsqueda vectorial con HNSW, full-text
 * en español sin tildes, `SKIP LOCKED` del outbox— son justamente las que
 * ningún doble sabe imitar. Levantar un contenedor propio por cada ejecución
 * añadiría medio minuto de arranque para obtener el mismo Postgres que ya está
 * corriendo. La base es OTRA (`..._test`) para que ejecutar los tests jamás
 * borre los datos con los que estabas trabajando.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const apiRoot = resolve(here, "../..");

/** Sufijo de la base de pruebas. Nunca se toca la de desarrollo. */
const TEST_DB_SUFFIX = "_test";

/**
 * Lee `DATABASE_URL` del `.env` del repositorio.
 *
 * No se usa `dotenv` para no cargar el resto del entorno: aquí solo interesa a
 * qué Postgres apuntar, y cualquier otra variable del `.env` de desarrollo
 * filtrándose en los tests sería una fuente de fallos difíciles de ver.
 */
const readEnvUrl = (variable: "DATABASE_URL" | "DATABASE_ADMIN_URL"): string => {
  const fromEnv = process.env[variable];
  if (fromEnv) return fromEnv;

  const envFile = resolve(repoRoot, ".env");
  if (!existsSync(envFile)) {
    throw new Error(
      "No hay .env en la raíz del repositorio y DATABASE_URL no está definida.\n" +
        "Copia .env.example a .env y levanta la infraestructura con `pnpm infra:up`.",
    );
  }

  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((row) => row.trimStart().startsWith(`${variable}=`));

  if (!line) throw new Error(`El .env no define ${variable}`);
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
};

/** `…/agentinmobi?schema=public` → `…/agentinmobi_test?schema=public` */
export const toTestDatabaseUrl = (devUrl: string): string => {
  const url = new URL(devUrl);
  const name = url.pathname.replace(/^\//, "");
  if (name.length === 0) throw new Error(`DATABASE_URL no incluye base de datos: ${devUrl}`);
  if (name.endsWith(TEST_DB_SUFFIX)) return url.toString();
  url.pathname = `/${name}${TEST_DB_SUFFIX}`;
  return url.toString();
};

const databaseNameOf = (url: string): string => new URL(url).pathname.replace(/^\//, "");

/** URL apuntando a la base de mantenimiento, para poder crear otra base. */
const toMaintenanceUrl = (url: string): string => {
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  return maintenance.toString();
};

/**
 * Crea la base de pruebas si no existe y aplica las migraciones.
 *
 * Se usan las MIGRACIONES reales y no `db push`: es la única forma de probar lo
 * que de verdad se despliega, incluida la migración que quitó la columna
 * generada `tsv` (D33). Un esquema empujado directamente desde el modelo se
 * parece al de producción, pero no es el mismo.
 */
export const prepareTestDatabase = async (): Promise<string> => {
  const testUrl = toTestDatabaseUrl(readEnvUrl("DATABASE_URL"));
  const testAdminUrl = toTestDatabaseUrl(readEnvUrl("DATABASE_ADMIN_URL"));
  const testName = databaseNameOf(testUrl);

  /*
   * La base se crea con el ADMINISTRADOR: el rol de la aplicación no puede
   * crear bases de datos, y eso es a propósito — es el mismo rol sin
   * superusuario que hace que Row Level Security proteja algo.
   */
  const admin = new PrismaClient({ datasources: { db: { url: toMaintenanceUrl(testAdminUrl) } } });

  try {
    await admin.$connect();
  } catch (error) {
    await admin.$disconnect().catch(() => undefined);
    throw new Error(
      `No se puede conectar a Postgres (${toMaintenanceUrl(testUrl)}).\n` +
        "Los tests de integración necesitan la base de datos real: arráncala con `pnpm infra:up`.\n" +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const existing = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      "SELECT count(*) AS count FROM pg_database WHERE datname = $1",
      testName,
    );
    if (Number(existing[0]?.count ?? 0) === 0) {
      // `CREATE DATABASE` no puede ir dentro de una transacción; por eso
      // `$executeRawUnsafe` y no `$transaction`. El nombre sale de nuestra
      // propia URL, no de ninguna entrada externa.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${testName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Extensiones, rol y permisos sobre la base recién creada. Sin esto, las
  // migraciones fallarían y —peor— RLS no protegería nada.
  await provisionAppRole({ adminUrl: testAdminUrl, appUrl: testUrl });

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  return testUrl;
};

/**
 * Vacía todas las tablas de negocio entre tests.
 *
 * `TRUNCATE … CASCADE` en una sola sentencia y no `DROP`/`migrate` por fichero:
 * recrear el esquema por cada test multiplicaría por veinte lo que tarda la
 * suite. Se excluye `_prisma_migrations` porque borrarla obligaría a volver a
 * migrar en cada limpieza.
 */
export const truncateAll = async (prisma: PrismaClient): Promise<void> => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};
