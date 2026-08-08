import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../../platform/config/env";
import type { Logger } from "../../platform/logging/logger";
import type { AppMetrics } from "../../platform/telemetry/app-metrics";
import type { PrometheusMetrics } from "../../platform/telemetry/prometheus-metrics";

/**
 * Instrumentación del HTTP y endpoint de exposición.
 *
 * Se instrumenta aquí, en un hook, y no en cada ruta: una ruta nueva se mide
 * sola. Medir dentro de cada manejador garantiza que la próxima que alguien
 * escriba se quede fuera y nadie lo note hasta que haya que mirarla.
 */

/** Formato de exposición de texto de Prometheus, versión 0.0.4. */
const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

declare module "fastify" {
  interface FastifyRequest {
    /** Instante de entrada, para medir sin depender del reloj de Fastify. */
    metricsStartedAt?: number;
  }
}

export const registerMetrics = (
  app: FastifyInstance,
  deps: {
    registry: PrometheusMetrics;
    metrics: AppMetrics;
    config: AppConfig;
    logger: Logger;
  },
): void => {
  const { registry, metrics, config, logger } = deps;

  instrumentRequests(app, metrics);
  registerProcessCollectors(registry, metrics, config);
  registerEndpoint(app, registry, config, logger);
};

const instrumentRequests = (app: FastifyInstance, metrics: AppMetrics): void => {
  app.addHook("onRequest", (request, _reply, done) => {
    request.metricsStartedAt = performance.now();
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const startedAt = request.metricsStartedAt;
    const route = routeOf(request);

    metrics.httpRequests.inc({
      method: request.method,
      route,
      status: statusClass(reply.statusCode),
    });

    if (startedAt !== undefined) {
      metrics.httpDuration.observe((performance.now() - startedAt) / 1000, {
        method: request.method,
        route,
      });
    }

    done();
  });
};

/**
 * Etiqueta `route`: el PATRÓN, nunca la URL.
 *
 * `/api/leads/:id` es una serie; `/api/leads/01H8…` sería una serie por lead, y
 * en un mes el sistema de monitorización tendría más series que leads el CRM
 * (D64). Una petición a una ruta inexistente se agrupa bajo un literal para que
 * un escaneo de rutas al azar tampoco pueda inflar la cardinalidad.
 */
const routeOf = (request: FastifyRequest): string =>
  request.routeOptions.url ?? "(desconocida)";

/**
 * El código exacto no se etiqueta, solo su familia.
 *
 * Lo que se pregunta de guardia es "¿está fallando?", y para eso `5xx` basta.
 * El código concreto está en el log de esa petición, con su `correlationId`.
 */
const statusClass = (status: number): string => `${String(Math.floor(status / 100))}xx`;

/**
 * Valores que ya viven en otro sitio y se leen al exponer.
 *
 * Empujarlos con un temporizador daría exactamente lo mismo a cambio de otro
 * temporizador que arrancar, parar y recordar en los tests.
 */
const registerProcessCollectors = (
  registry: PrometheusMetrics,
  metrics: AppMetrics,
  config: AppConfig,
): void => {
  /*
   * `build_info` vale siempre 1 y toda su información está en las etiquetas.
   * Es el truco estándar y resuelve la pregunta que más se repite en un
   * incidente: "¿qué versión hay desplegada, y en qué modo corre?".
   */
  metrics.buildInfo.set(1, {
    version: config.app.version,
    environment: config.env,
    llm_provider: config.providers.llm,
    embedding_provider: config.providers.embedding,
  });

  const startedAt = performance.now();
  registry.onCollect(() => {
    metrics.processUptime.set((performance.now() - startedAt) / 1000);
    metrics.processHeapBytes.set(process.memoryUsage().heapUsed);
  });
};

const registerEndpoint = (
  app: FastifyInstance,
  registry: PrometheusMetrics,
  config: AppConfig,
  logger: Logger,
): void => {
  if (!config.metrics.enabled) {
    logger.info("Métricas desactivadas por configuración");
    return;
  }

  const token = config.metrics.token;

  /*
   * Falla cerrada. El endpoint publica la versión desplegada, el gasto
   * acumulado y el mapa de rutas: es reconocimiento gratis para quien lo
   * encuentre. En producción sin token no se registra, y el arranque lo dice
   * en vez de dejar una puerta abierta que nadie mira.
   */
  if (config.isProduction && !token) {
    logger.warn(
      "GET /metrics NO se registra: en producción exige METRICS_TOKEN. " +
        "Define la variable para que el recolector pueda leerlas.",
    );
    return;
  }

  app.get("/metrics", (request: FastifyRequest, reply: FastifyReply) => {
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      // 404 y no 401: a quien no tiene el token no se le confirma que exista.
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Ruta no encontrada: GET /metrics" },
      });
    }

    return reply.header("Content-Type", CONTENT_TYPE).send(registry.render());
  });

  logger.info("Métricas expuestas en GET /metrics", { protegidas: token !== undefined });
};
