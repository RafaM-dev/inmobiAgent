import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppCradle, AppModule } from "./container";
import { registerErrorHandler } from "./http/error-handler";
import { registerNotFound } from "./http/not-found";
import { registerMetrics } from "./http/metrics.plugin";
import { registerRequestContext } from "./http/request-context.plugin";
import { registerSessionSupport } from "./http/session.plugin";
import { registerHealthRoutes } from "./routes/health.route";

/**
 * Construcción del servidor HTTP.
 *
 * El servidor no conoce ningún módulo de negocio: recorre la lista de módulos y
 * les pide que registren sus rutas. Añadir el canal de WhatsApp en F6 no tocará
 * este archivo.
 */
export const createServer = async (
  cradle: AppCradle,
  modules: readonly AppModule[],
): Promise<FastifyInstance> => {
  const { config, logger } = cradle;

  const app = Fastify({
    // Los logs los lleva nuestro puerto Logger, no el de Fastify: así una sola
    // configuración de redacción y correlación cubre HTTP, jobs y agente.
    logger: false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  registerRequestContext(app, cradle.ids);
  registerErrorHandler(app, logger.child({ component: "http" }));

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.http.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    /*
     * Los webhooks de canal se saltan el límite por IP porque este cuenta por
     * IP, y por la IP de un proveedor entran los mensajes de TODAS las
     * inmobiliarias: cortar aquí castigaría a las demás por el bucle de una.
     * Su límite es por inmobiliaria y vive en `ReceiveInboundMessage` (D60).
     */
    allowList: (request) => request.url.startsWith("/webhooks/"),
  });

  registerMetrics(app, {
    registry: cradle.metricsRegistry,
    metrics: cradle.appMetrics,
    config,
    logger: logger.child({ component: "metrics" }),
  });

  await registerSessionSupport(app);

  registerHealthRoutes(app, cradle);

  for (const module of modules) {
    if (module.registerRoutes) {
      await module.registerRoutes(app, cradle);
      logger.debug("Rutas del módulo registradas", { module: module.name });
    }
  }

  /*
   * Al final, y a propósito: el panel es la alternativa cuando NINGUNA ruta de
   * negocio ha coincidido. Registrarlo antes lo pondría por delante de rutas
   * que sí existen.
   */
  await registerNotFound(app, {
    ...(config.http.webRoot !== undefined ? { webRoot: config.http.webRoot } : {}),
    logger: logger.child({ component: "http" }),
  });

  return app;
};
