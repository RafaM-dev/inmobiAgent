import { existsSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { RLS_PROTECTED_TABLES } from "../prisma/rls/tables";
import { latestBackup } from "./backup";
import { databaseNameOf, resolveRunner, withDatabase, type PgRunner } from "./pg-tools";

/**
 * Restaura una copia en una base desechable y comprueba que sirve.
 *
 * **Un backup que nunca se ha restaurado no es un backup: es un fichero.** Esta
 * es la mitad del trabajo que casi nadie hace, y la única que demuestra algo.
 *
 * No se limita a comprobar que `pg_restore` no protesta. Comprueba lo que este
 * sistema necesita para seguir siendo correcto después de una restauración, y
 * cada comprobación existe porque su ausencia produce un fallo SILENCIOSO:
 *
 *  · **RLS activo Y forzado.** Es el fallo de D55 otra vez, pero peor: una base
 *    restaurada sin `FORCE` funciona perfectamente y deja de aislar a las
 *    inmobiliarias entre sí. Nada falla; simplemente se ven datos ajenos.
 *  · **Los permisos del rol de la aplicación.** Si el volcado se hizo con
 *    `--no-acl`, la base restaurada arranca y la aplicación no puede leer nada.
 *  · **Las extensiones.** Sin `vector` no hay búsqueda; sin `unaccent`, el
 *    agente deja de encontrar "comisión" cuando le escriben "comision".
 *  · **El índice HNSW.** Su ausencia no da error: da una búsqueda que recorre
 *    la tabla entera y un agente que tarda diez segundos en responder.
 *  · **Las filas.** Un volcado hecho con el rol equivocado sale con el esquema
 *    entero y CERO filas, y tiene exactamente el mismo aspecto que uno bueno.
 */

/** Base de trabajo. Se crea y se destruye en cada ejecución. */
const SCRATCH = process.env["RESTORE_CHECK_DB"] ?? "agentinmobi_restore_check";

const EXTENSIONS = ["vector", "unaccent", "pg_trgm", "pgcrypto"] as const;
const HNSW_INDEX = "document_chunks_embedding_idx";

/** Tablas sin `tenant_id` que igualmente tienen que llegar con sus filas. */
const GLOBAL_TABLES = ["tenants", "users", "channel_accounts"] as const;

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const maintenanceUrl = (url: string): string => withDatabase(url, "postgres");

const connect = (url: string): PrismaClient =>
  new PrismaClient({ datasources: { db: { url } } });

/* -------------------------------------------------------------------------- *
 * Comprobaciones
 * -------------------------------------------------------------------------- */

const checkExtensions = async (db: PrismaClient): Promise<Check> => {
  const rows = await db.$queryRawUnsafe<{ extname: string }[]>(
    "SELECT extname FROM pg_extension",
  );
  const present = new Set(rows.map((row) => row.extname));
  const missing = EXTENSIONS.filter((name) => !present.has(name));

  return {
    name: "Extensiones",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? EXTENSIONS.join(", ")
        : `faltan: ${missing.join(", ")} — sin ellas la búsqueda no funciona`,
  };
};

const checkRowLevelSecurity = async (db: PrismaClient): Promise<Check> => {
  const rows = await db.$queryRawUnsafe<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );

  const byName = new Map(rows.map((row) => [row.relname, row]));
  const broken = RLS_PROTECTED_TABLES.filter((table) => {
    const row = byName.get(table);
    return !row?.relrowsecurity || !row.relforcerowsecurity;
  });

  return {
    name: "RLS activo y forzado",
    ok: broken.length === 0,
    detail:
      broken.length === 0
        ? `${String(RLS_PROTECTED_TABLES.length)} tablas protegidas`
        : `sin proteger: ${broken.join(", ")} — la base restaurada NO aísla inmobiliarias`,
  };
};

const checkPolicies = async (db: PrismaClient): Promise<Check> => {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'",
  );

  const withPolicy = new Set(rows.map((row) => row.tablename));
  const missing = RLS_PROTECTED_TABLES.filter((table) => !withPolicy.has(table));

  return {
    name: "Políticas de aislamiento",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${String(withPolicy.size)} políticas \`tenant_isolation\``
        : `faltan en: ${missing.join(", ")}`,
  };
};

const checkGrants = async (db: PrismaClient, appRole: string): Promise<Check> => {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = $1 AND privilege_type = 'SELECT'`,
    appRole,
  );

  const granted = Number(rows[0]?.count ?? 0);

  return {
    name: "Permisos del rol de la aplicación",
    ok: granted >= RLS_PROTECTED_TABLES.length,
    detail:
      granted >= RLS_PROTECTED_TABLES.length
        ? `${String(granted)} tablas legibles por ${appRole}`
        : `solo ${String(granted)} tablas: la aplicación arrancaría sin poder leer nada`,
  };
};

const checkHnswIndex = async (db: PrismaClient): Promise<Check> => {
  const rows = await db.$queryRawUnsafe<{ indexdef: string }[]>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
    HNSW_INDEX,
  );

  const definition = rows[0]?.indexdef ?? "";
  const ok = definition.toLowerCase().includes("hnsw");

  return {
    name: "Índice vectorial HNSW",
    ok,
    // Su ausencia no rompe nada: hace que cada búsqueda recorra la tabla entera.
    detail: ok ? HNSW_INDEX : `${HNSW_INDEX} ausente o sin HNSW: la búsqueda sería secuencial`,
  };
};

const countRows = async (
  db: PrismaClient,
  tables: readonly string[],
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();

  for (const table of tables) {
    // Nombre de tabla de nuestra propia lista, no de una entrada externa.
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "public"."${table}"`,
    );
    counts.set(table, Number(rows[0]?.count ?? 0));
  }

  return counts;
};

const checkRowCounts = (source: Map<string, number>, restored: Map<string, number>): Check => {
  const differences: string[] = [];
  let total = 0;

  for (const [table, expected] of source) {
    const actual = restored.get(table) ?? -1;
    total += expected;
    if (actual !== expected) {
      differences.push(`${table}: ${String(expected)} → ${String(actual)}`);
    }
  }

  return {
    name: "Filas restauradas",
    ok: differences.length === 0,
    detail:
      differences.length > 0
        ? differences.join("; ")
        : total === 0
          ? "0 filas (la base de origen está vacía: el resultado es correcto pero no demuestra mucho)"
          : `${String(total)} filas en ${String(source.size)} tablas`,
  };
};

const checkMigrationState = async (
  source: PrismaClient,
  restored: PrismaClient,
): Promise<Check> => {
  const latest = async (db: PrismaClient): Promise<string> => {
    const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`,
    );
    return rows[0]?.migration_name ?? "(ninguna)";
  };

  const [expected, actual] = await Promise.all([latest(source), latest(restored)]);

  return {
    name: "Versión del esquema",
    ok: expected === actual,
    // Saber a qué migración corresponde un backup es la diferencia entre
    // restaurarlo con confianza y restaurarlo cruzando los dedos.
    detail: expected === actual ? actual : `origen ${expected}, restaurado ${actual}`,
  };
};

/* -------------------------------------------------------------------------- *
 * Orquestación
 * -------------------------------------------------------------------------- */

const dropScratch = async (adminUrl: string): Promise<void> => {
  const maintenance = connect(maintenanceUrl(adminUrl));
  try {
    // `WITH (FORCE)` echa a las conexiones que hayan quedado colgando; sin él,
    // una ejecución interrumpida deja la base bloqueada para siempre.
    await maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
  } finally {
    await maintenance.$disconnect();
  }
};

const createScratch = async (adminUrl: string): Promise<void> => {
  const maintenance = connect(maintenanceUrl(adminUrl));
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`);
  } finally {
    await maintenance.$disconnect();
  }
};

const restoreInto = (runner: PgRunner, adminUrl: string, dumpPath: string): void => {
  const staged = runner.stage(dumpPath);
  try {
    runner.run("pg_restore", [
      "--dbname",
      runner.urlFor(withDatabase(adminUrl, SCRATCH)),
      // Sin `--exit-on-error`: un volcado hecho en otra máquina puede traer
      // órdenes de propiedad sobre roles que aquí no existen, y eso no invalida
      // los datos. Lo que importa lo dicen las comprobaciones, no el código de
      // salida de la herramienta.
      "--no-password",
      staged,
    ]);
  } catch (error) {
    // `pg_restore` devuelve distinto de cero también por avisos. Se registra y
    // se sigue: si el volcado no sirve, las comprobaciones lo dirán con detalle.
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`  (pg_restore terminó con avisos: ${detail.split("\n")[0] ?? ""})`);
  } finally {
    runner.unstage(staged);
  }
};

export const verifyRestore = async (input: {
  adminUrl: string;
  appUrl: string;
  dumpPath: string;
}): Promise<{ checks: Check[]; ok: boolean }> => {
  const runner = resolveRunner();
  const appRole = decodeURIComponent(new URL(input.appUrl).username);
  const tables = [...RLS_PROTECTED_TABLES, ...GLOBAL_TABLES];

  const source = connect(input.adminUrl);
  let sourceCounts: Map<string, number>;
  try {
    sourceCounts = await countRows(source, tables);
  } catch (error) {
    await source.$disconnect();
    throw error;
  }

  await dropScratch(input.adminUrl);
  await createScratch(input.adminUrl);

  const restored = connect(withDatabase(input.adminUrl, SCRATCH));

  try {
    restoreInto(runner, input.adminUrl, input.dumpPath);

    const checks: Check[] = [
      await checkExtensions(restored),
      await checkRowLevelSecurity(restored),
      await checkPolicies(restored),
      await checkGrants(restored, appRole),
      await checkHnswIndex(restored),
      checkRowCounts(sourceCounts, await countRows(restored, tables)),
      await checkMigrationState(source, restored),
    ];

    return { checks, ok: checks.every((check) => check.ok) };
  } finally {
    await restored.$disconnect();
    await source.$disconnect();
    // La base de trabajo no sobrevive a la comprobación, pase lo que pase.
    await dropScratch(input.adminUrl);
  }
};

/* -------------------------------------------------------------------------- *
 * CLI
 * -------------------------------------------------------------------------- */

const isCli =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isCli) {
  const run = async (): Promise<void> => {
    const adminUrl = process.env["DATABASE_ADMIN_URL"];
    const appUrl = process.env["DATABASE_URL"];
    if (!adminUrl || !appUrl) throw new Error("Faltan DATABASE_ADMIN_URL o DATABASE_URL");

    const dumpPath = process.argv[2] ?? latestBackup();
    if (!dumpPath) {
      throw new Error("No hay ninguna copia. Crea una con `pnpm --filter @agentinmobi/api db:backup`.");
    }
    if (!existsSync(dumpPath)) throw new Error(`No existe el fichero: ${dumpPath}`);

    console.log(`Restaurando ${dumpPath}`);
    console.log(`  en la base desechable "${SCRATCH}" de ${databaseNameOf(adminUrl)}\n`);

    const { checks, ok } = await verifyRestore({ adminUrl, appUrl, dumpPath });

    const width = Math.max(...checks.map((check) => check.name.length));
    for (const check of checks) {
      console.log(`  ${check.ok ? "✔" : "✖"} ${check.name.padEnd(width)}  ${check.detail}`);
    }

    console.log("");
    if (ok) {
      console.log("✔ La copia se restaura y la base restaurada es correcta.");
      return;
    }

    console.error("✖ La copia NO sirve tal cual. Revisa lo marcado arriba antes de confiar en ella.");
    process.exitCode = 1;
  };

  run().catch((error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
