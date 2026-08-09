import type { AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../platform/config/env";
import type { Logger } from "../platform/logging/logger";
import { asValue } from "awilix";
import { buildContainer, type AppCradle, type AppModule } from "./container";
import { appModules } from "./modules.registry";
import { createServer } from "./server";

export type AppRole = "api" | "worker" | "all";

export interface ApplicationOptions {
  config: AppConfig;
  /** `api` sirve HTTP; `worker` procesa outbox y jobs; `all` hace ambos. */
  role?: AppRole;
  modules?: readonly AppModule[];
  /**
   * `false` construye el servidor pero NO abre el socket.
   *
   * Existe para los tests de integración: se ejercita el HTTP real —los mismos
   * plugins, el mismo guardia de sesión, el mismo manejador de errores— con
   * `app.inject()`, sin puertos que colisionen entre ficheros de test que corren
   * en paralelo. Probar contra un Fastify montado a mano en el test no
   * demostraría nada sobre el que arranca en producción.
   */
  listen?: boolean;

  /**
   * Sustituciones en el contenedor, aplicadas antes de registrar los módulos.
   *
   * Costura de pruebas, y la única: permite cambiar una pieza de infraestructura
   * —el notificador, un reloj fijo— dejando en pie TODO lo demás. Sin ella,
   * probar un flujo que manda un correo obligaría a montar un servidor SMTP en
   * cada test o a no probarlo, y lo segundo es lo que suele pasar.
   *
   * No se usa en producción: `main.ts` no la pasa nunca.
   */
  overrides?: Partial<Record<keyof AppCradle, unknown>>;
}

/**
 * Ciclo de vida de la aplicación.
 *
 * El mismo código arranca como API, como worker o como ambos. En desarrollo se
 * usa `all` (un solo proceso, cero fricción); en producción se despliegan dos
 * réplicas con roles distintos y se escalan por separado — sin cambiar nada.
 */
export class Application {
  private readonly container: AwilixContainer<AppCradle>;
  private readonly modules: readonly AppModule[];
  private readonly role: AppRole;
  private readonly logger: Logger;
  private server: FastifyInstance | undefined;
  private started: AppModule[] = [];

  constructor(private readonly options: ApplicationOptions) {
    this.role = options.role ?? "all";
    this.container = buildContainer(options.config);

    for (const [name, value] of Object.entries(options.overrides ?? {})) {
      this.container.register({ [name]: asValue(value) });
    }

    this.modules = options.modules ?? appModules;
    this.logger = this.cradle.logger.child({ component: "application", role: this.role });
  }

  get cradle(): AppCradle {
    return this.container.cradle;
  }

  /** Servidor HTTP ya montado. `undefined` si el rol no sirve HTTP. */
  get httpServer(): FastifyInstance | undefined {
    return this.server;
  }

  async start(): Promise<void> {
    const { config } = this.options;
    this.logger.info("Arrancando aplicación", {
      version: config.app.version,
      env: config.env,
      providers: {
        llm: config.providers.llm,
        embedding: config.providers.embedding,
        property: config.providers.property,
      },
    });

    // 1. Infraestructura base.
    await this.cradle.database.connect();

    // 2. Registro de módulos: dependencias primero, luego suscripciones.
    for (const module of this.modules) {
      module.registerDependencies(this.container);
    }
    for (const module of this.modules) {
      for (const sub of module.registerSubscriptions?.(this.cradle) ?? []) {
        this.cradle.eventBus.subscribe(sub);
        this.logger.debug("Suscripción registrada", {
          module: module.name,
          handler: sub.name,
          event: sub.event.type,
        });
      }
    }

    // 3. Arranque de cada módulo (orden declarado).
    for (const module of this.modules) {
      await module.onStart?.(this.cradle);
      this.started.push(module);
    }

    // 4. Roles.
    if (this.role === "worker" || this.role === "all") {
      this.cradle.outboxRelay.start();
    }

    if (this.role === "api" || this.role === "all") {
      this.server = await createServer(this.cradle, this.modules);

      if (this.options.listen === false) {
        // Rutas registradas y plugins listos, pero sin socket. `inject()` sirve
        // peticiones contra este mismo servidor.
        await this.server.ready();
      } else {
        await this.server.listen({ host: config.http.host, port: config.http.port });
        this.logger.info("API escuchando", {
          url: `http://${config.http.host}:${String(config.http.port)}`,
        });
      }
    }

    this.logger.info("Aplicación lista", { modules: this.modules.map((m) => m.name) });
  }

  /** Apagado ordenado: se deja de aceptar tráfico antes de soltar recursos. */
  async stop(): Promise<void> {
    this.logger.info("Deteniendo aplicación");

    if (this.server) {
      await this.server.close();
      this.server = undefined;
    }

    await this.cradle.outboxRelay.stop();

    for (const module of [...this.started].reverse()) {
      try {
        await module.onStop?.(this.cradle);
      } catch (error) {
        this.logger.error("Fallo al detener módulo", {
          module: module.name,
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.started = [];

    await this.cradle.database.disconnect();
    this.logger.info("Aplicación detenida");
  }
}

/**
 * Apagado ordenado ante señales del orquestador.
 *
 * Sin esto, un despliegue corta conversaciones a medias: mensajes de WhatsApp
 * recibidos y nunca respondidos.
 */
export const installShutdownHooks = (app: Application, logger: Logger): void => {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Señal de apagado recibida", { signal });

    const timeout = setTimeout(() => {
      logger.fatal("El apagado ordenado excedió el tiempo límite; se fuerza la salida");
      process.exit(1);
    }, 15_000);
    timeout.unref();

    void app
      .stop()
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.fatal("Fallo durante el apagado", {
          err: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Promesa rechazada sin manejar", {
      err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
    });
  });

  process.on("uncaughtException", (error) => {
    logger.fatal("Excepción no capturada", { err: { message: error.message, stack: error.stack } });
    shutdown("uncaughtException");
  });
};
