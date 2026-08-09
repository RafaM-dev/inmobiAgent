import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureSearchIndexes } from "../../scripts/ensure-search-indexes";
import { provisionAppRole } from "../../scripts/provision-db-role";

/**
 * Paso de RELEASE: deja la base lista para la versión que se está desplegando.
 *
 * Se ejecuta UNA VEZ por despliegue, antes de arrancar instancias nuevas, y no
 * en el arranque de cada proceso. Migrar al arrancar hace que dos instancias
 * levantándose a la vez compitan por el mismo `ALTER TABLE`; el fallo aparece
 * en uno de cada diez despliegues, que es la peor frecuencia posible para
 * diagnosticar nada.
 *
 * Los tres pasos van en este orden y ninguno es opcional:
 *
 * 1. **Provisionar el rol.** Sin un rol sin `BYPASSRLS`, Row Level Security no
 *    protege nada: un superusuario se salta todas las políticas. Es idempotente.
 * 2. **Migrar.** `prisma migrate deploy`, que solo aplica migraciones ya
 *    escritas y nunca genera ninguna.
 * 3. **Recrear los índices de búsqueda.** Prisma no sabe expresar el HNSW de
 *    pgvector y lo trata como deriva, así que genera un `DROP INDEX` cada vez
 *    que alguien crea una migración. Perderlo no rompe nada: solo convierte
 *    cada búsqueda en un recorrido de la tabla entera.
 */
const run = async (): Promise<void> => {
  const appUrl = process.env["DATABASE_URL"];
  const adminUrl = process.env["DATABASE_ADMIN_URL"] ?? appUrl;

  if (!appUrl || !adminUrl) {
    process.stderr.write("Falta DATABASE_URL.\n");
    process.exit(1);
  }

  const provisioned = await provisionAppRole({ adminUrl, appUrl });
  if (provisioned.bypassesRls) {
    process.stderr.write(
      `\n${provisioned.message}\n` +
        "Define DATABASE_ADMIN_URL con el superusuario y deja DATABASE_URL\n" +
        "apuntando a un rol distinto; este paso lo crea.\n\n",
    );
    process.exit(1);
  }
  process.stdout.write(`${provisioned.message}\n`);

  /*
   * El CLI de Prisma se invoca como proceso aparte porque no tiene API de
   * programa para `migrate deploy`. Va con `stdio: "inherit"` para que el SQL
   * que aplica salga en el log del despliegue: si algo sale mal, lo primero que
   * se quiere ver es qué migración estaba corriendo.
   */
  /*
   * El esquema se pasa EXPLÍCITO en vez de dejar que el CLI lo busque.
   *
   * Lo encontraría a través de `prisma.config.ts`, que es TypeScript y carga
   * `dotenv` —una dependencia de desarrollo—: en la imagen de producción no
   * está ninguna de las dos cosas. Derivarlo de la ubicación del propio bundle
   * funciona igual en el contenedor y en local, sin un archivo intermedio que
   * pueda faltar.
   */
  const schema = fileURLToPath(new URL("../prisma/schema", import.meta.url));

  const migrated = spawnSync("prisma", ["migrate", "deploy", "--schema", schema], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (migrated.status !== 0) {
    process.stderr.write("Las migraciones fallaron. No se arranca nada.\n");
    process.exit(migrated.status ?? 1);
  }

  const created = await ensureSearchIndexes(appUrl);
  process.stdout.write(
    created.length === 0
      ? "Índices de búsqueda en su sitio.\n"
      : `Índices de búsqueda recreados: ${created.join(", ")}\n`,
  );
};

run().catch((error: unknown) => {
  process.stderr.write(
    `Fallo en el paso de release: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
