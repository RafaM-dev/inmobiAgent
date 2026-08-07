import { prepareTestDatabase } from "./test-database";

/**
 * Se ejecuta UNA vez antes de toda la suite de integración.
 *
 * Crea la base de pruebas y aplica las migraciones. El resultado viaja a los
 * tests por `process.env.TEST_DATABASE_URL`, que es lo único que cada fichero
 * necesita saber.
 */
export default async function setup(): Promise<void> {
  const url = await prepareTestDatabase();
  process.env["TEST_DATABASE_URL"] = url;
}
