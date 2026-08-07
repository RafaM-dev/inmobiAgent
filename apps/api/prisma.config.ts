import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

// El `.env` vive en la raíz del monorepo: una sola configuración para API,
// worker y herramientas. La CLI de Prisma no lo carga sola.
loadDotenv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema"),
});
