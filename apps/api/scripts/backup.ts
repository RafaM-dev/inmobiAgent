import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseNameOf, resolveRunner } from "./pg-tools";

/**
 * Copia de seguridad de la base de datos.
 *
 * **Formato personalizado (`-Fc`), no SQL plano.** Cuesta lo mismo de hacer y
 * permite tres cosas que el día del incidente son la diferencia entre una hora
 * y una tarde: restaurar en paralelo, restaurar UNA tabla sin tocar el resto, y
 * listar el contenido del volcado sin restaurar nada.
 *
 * **Se conecta como administrador**, no con el rol de la aplicación. Ese rol no
 * es superusuario a propósito (D55) y con RLS forzado solo vería las filas de
 * su contexto de tenant — que no hay ninguno. Un backup hecho con él saldría
 * vacío y **parecería correcto**: mismo esquema, mismos índices, cero filas.
 *
 * Este script no sustituye a las copias del proveedor gestionado si lo hay; le
 * añade lo que ninguno da: un volcado propio, portable y —con
 * `pnpm db:verify-restore`— comprobado.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

/** Volcados que se conservan. Los más viejos se van borrando. */
const KEEP = Number(process.env["BACKUP_KEEP"] ?? 7);

const PREFIX = "agentinmobi-";
const SUFFIX = ".dump";

export interface BackupResult {
  readonly filePath: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly removed: readonly string[];
}

/** `2026-08-08T14:32:05.123Z` → `20260808-143205`, que ordena igual y se lee mejor. */
const stamp = (now: Date): string =>
  now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export const backupDirectory = (): string =>
  process.env["BACKUP_DIR"] ?? join(repoRoot, "backups");

export const createBackup = (options: { adminUrl: string; now?: Date } = { adminUrl: "" }): BackupResult => {
  const adminUrl = options.adminUrl;
  if (!adminUrl) throw new Error("Falta DATABASE_ADMIN_URL");

  const runner = resolveRunner();
  const directory = backupDirectory();
  mkdirSync(directory, { recursive: true });

  const database = databaseNameOf(adminUrl);
  const filePath = join(directory, `${PREFIX}${database}-${stamp(options.now ?? new Date())}${SUFFIX}`);

  const startedAt = performance.now();
  runner.runToFile(
    "pg_dump",
    [
      "--dbname",
      runner.urlFor(adminUrl),
      "--format",
      "custom",
      // Nivel 6: el volcado baja mucho y la CPU apenas se nota. El 9 tarda el
      // triple para ahorrar un uno por ciento.
      "--compress",
      "6",
      /*
       * Sin `--no-owner` ni `--no-acl` a propósito: los permisos son parte de
       * lo que protege a las inmobiliarias entre sí. Un volcado que los pierde
       * restaura una base donde el rol de la aplicación podría no tener los
       * GRANT que las políticas de RLS dan por hechos.
       */
    ],
    filePath,
  );
  const durationMs = Math.round(performance.now() - startedAt);
  const bytes = statSync(filePath).size;

  if (bytes === 0) {
    rmSync(filePath, { force: true });
    throw new Error("El volcado salió vacío. No se conserva un backup que no sirve.");
  }

  return { filePath, bytes, durationMs, removed: prune(directory) };
};

/**
 * Retención por número de ficheros, no por antigüedad.
 *
 * Por antigüedad, una semana sin ejecutar el script borraría todo lo que hay
 * justo cuando es lo único que queda. Por número, el más antiguo sobrevive
 * hasta que hay uno nuevo que lo reemplace.
 */
const prune = (directory: string): string[] => {
  if (KEEP <= 0) return [];

  const dumps = readdirSync(directory)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort()
    .reverse();

  const removed = dumps.slice(KEEP);
  for (const name of removed) rmSync(join(directory, name), { force: true });
  return removed;
};

/** Volcado más reciente. `null` si no hay ninguno. */
export const latestBackup = (): string | null => {
  const directory = backupDirectory();
  if (!existsSync(directory)) return null;

  const dumps = readdirSync(directory)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort();

  const last = dumps.at(-1);
  return last ? join(directory, last) : null;
};

const formatBytes = (bytes: number): string => {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${String(Math.round(bytes / 1024))} KB`;
};

/* -------------------------------------------------------------------------- *
 * CLI
 * -------------------------------------------------------------------------- */

const isCli = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isCli) {
  try {
    const result = createBackup({ adminUrl: process.env["DATABASE_ADMIN_URL"] ?? "" });

    console.log(`✔ Copia creada: ${result.filePath}`);
    console.log(`  ${formatBytes(result.bytes)} en ${String(result.durationMs)} ms`);
    if (result.removed.length > 0) {
      console.log(`  Retención (${String(KEEP)}): se borraron ${String(result.removed.length)}`);
    }
    console.log("");
    console.log("Un backup que nunca se ha restaurado no es un backup:");
    console.log("  pnpm --filter @agentinmobi/api db:verify-restore");
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
