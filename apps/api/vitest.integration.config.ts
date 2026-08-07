import { defineConfig } from "vitest/config";

/**
 * Suite de integración: Postgres real y HTTP real.
 *
 * Va en una configuración aparte porque tiene un requisito que la suite unitaria
 * no tiene —infraestructura levantada— y un coste distinto. Mezclarlas volvería
 * lento el bucle de trabajo y haría que un `pnpm test` en un clon recién hecho
 * fallara por algo que no es el código.
 *
 * `fileParallelism: false`: todos los ficheros comparten una única base de
 * pruebas y cada uno la vacía entre tests. En paralelo, el `TRUNCATE` de uno
 * borraría los datos de otro a mitad de aserción — un fallo intermitente, que
 * es la peor clase de fallo que puede tener una suite.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["test/support/global-setup.ts"],
    fileParallelism: false,
    // Migrar y arrancar la aplicación entera tarda más que una función pura.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
