import { Application, installShutdownHooks, type AppRole } from "./bootstrap/application";
import { ConfigurationError, loadConfig } from "./platform/config/env";
import { createPinoRoot, PinoLogger } from "./platform/logging/pino-logger";

/**
 * Punto de entrada del proceso.
 *
 * Responsabilidad única: cargar configuración, construir la aplicación,
 * arrancarla y fallar ruidosamente si algo va mal. Ninguna lógica de negocio.
 */
const main = async (): Promise<void> => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.stderr.write(
        "Sugerencia: copia .env.example a .env. Los valores por defecto arrancan " +
          "el producto completo en modo demo, sin ninguna API key.\n\n",
      );
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const role = (process.env["APP_ROLE"] as AppRole | undefined) ?? "all";
  const app = new Application({ config, role });
  const logger = new PinoLogger(createPinoRoot(config)).child({ component: "main" });

  installShutdownHooks(app, logger);

  try {
    await app.start();
  } catch (error) {
    logger.fatal("Fallo al arrancar la aplicación", {
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    await app.stop().catch(() => undefined);
    process.exit(1);
  }
};

void main();
