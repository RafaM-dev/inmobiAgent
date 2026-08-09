import type { FastifyInstance } from "fastify";
import { Application } from "../../src/bootstrap/application";
import { PrismaClient } from "@prisma/client";
import { loadConfig, type AppConfig } from "../../src/platform/config/env";
import { Database, type PrismaTx } from "../../src/platform/database/prisma";
import { NoopLogger } from "../../src/platform/logging/logger";
import { truncateAll } from "./test-database";

/**
 * Arnés de los tests de integración.
 *
 * Ofrece dos niveles, y la diferencia importa:
 *
 * - `withDatabase()` — solo Postgres. Para probar un repositorio contra el SQL
 *   de verdad, sin arrancar la aplicación.
 * - `withApplication()` — la aplicación ENTERA: contenedor de DI, módulos,
 *   eventos, outbox y servidor HTTP montado sin abrir socket. Es el mismo
 *   arranque que usa el proceso en producción; probar contra un Fastify
 *   ensamblado a mano en el test no diría nada sobre el que se despliega.
 */

const testDatabaseUrl = (): string => {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL no está definida. Estos tests se ejecutan con " +
        "`pnpm test:integration`, que prepara la base de pruebas antes de correrlos.",
    );
  }
  return url;
};

/**
 * Configuración de los tests.
 *
 * Parte de la real —el mismo `loadConfig` con el mismo esquema Zod— y solo
 * cambia lo imprescindible: la base de datos y el ruido. Inventar aquí un
 * objeto de configuración a mano dejaría los tests corriendo con ajustes que
 * ningún despliegue usa.
 */
export const testConfig = (overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig =>
  loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DATABASE_URL: testDatabaseUrl(),
    // Clave de 32 bytes en base64. De pruebas y evidente.
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    ...overrides,
  });

export interface DatabaseContext {
  readonly prisma: PrismaClient;
  readonly database: Database;
  /** Deja la base vacía. Se llama en `beforeEach`. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export const withDatabase = async (): Promise<DatabaseContext> => {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  await prisma.$connect();

  const database = new Database(prisma, new NoopLogger());

  return {
    prisma,
    database,
    reset: () => truncateAll(prisma),
    close: async () => {
      await prisma.$disconnect();
    },
  };
};

export interface ApplicationContext {
  readonly app: Application;
  readonly server: FastifyInstance;
  /**
   * Cliente CRUDO, sin contexto de tenant.
   *
   * Con RLS activo no ve nada de las tablas protegidas — que es justo lo que
   * debe pasar. Para inspeccionar o manipular datos de negocio en un test, usa
   * `sql()`, que cruza la frontera diciéndolo.
   */
  readonly prisma: PrismaClient;
  /** SQL crudo con acceso a todas las inmobiliarias. Para montar escenarios. */
  sql<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const withApplication = async (
  overrides: Partial<NodeJS.ProcessEnv> = {},
  /** Piezas del contenedor sustituidas: el notificador, un reloj fijo… */
  cradleOverrides: Partial<Record<string, unknown>> = {},
): Promise<ApplicationContext> => {
  const application = new Application({
    config: testConfig(overrides),
    overrides: cradleOverrides,
    role: "api",
    // Sin socket: varios ficheros de test corren en paralelo y pelearían por
    // el puerto.
    listen: false,
  });

  await application.start();

  const server = application.httpServer;
  if (!server) throw new Error("La aplicación arrancó sin servidor HTTP");

  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  await prisma.$connect();

  return {
    app: application,
    server,
    prisma,
    sql: (fn) => application.cradle.database.runAcrossTenants("escenario de test", fn),
    reset: () => truncateAll(prisma),
    stop: async () => {
      await application.stop();
      await prisma.$disconnect();
    },
  };
};
