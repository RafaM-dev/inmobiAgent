import type { HealthResponse } from "@agentinmobi/contracts";
import type { FastifyInstance } from "fastify";
import type { AppCradle } from "../container";

/**
 * Sondas de salud.
 *
 *  - `/health/live`  ¿el proceso está vivo? No toca dependencias. Es la sonda
 *    de liveness: si falla, hay que reiniciar el contenedor.
 *  - `/health/ready` ¿puede atender tráfico? Verifica dependencias. Es la sonda
 *    de readiness: si falla, se saca de balanceo pero NO se reinicia.
 *
 * Distinguirlas evita el clásico bucle de reinicios cuando lo que está caído es
 * la base de datos, no la aplicación.
 */
export const registerHealthRoutes = (app: FastifyInstance, cradle: AppCradle): void => {
  const startedAt = cradle.clock.nowMs();

  app.get("/health/live", () => ({ status: "ok" as const }));

  app.get("/health/ready", async (_request, reply) => {
    const db = await cradle.database.ping();

    const body: HealthResponse = {
      status: db.ok ? "ok" : "error",
      version: cradle.config.app.version,
      environment: cradle.config.env,
      uptimeSeconds: Math.round((cradle.clock.nowMs() - startedAt) / 1000),
      dependencies: [
        {
          name: "postgres",
          status: db.ok ? "up" : "down",
          latencyMs: db.latencyMs,
          ...(db.detail ? { detail: db.detail } : {}),
        },
        // Los proveedores intercambiables se reportan para hacer visible en qué
        // modo corre la instancia: en demo, todos dicen "mock".
        { name: `llm:${cradle.config.providers.llm}`, status: "up" },
        { name: `embeddings:${cradle.config.providers.embedding}`, status: "up" },
        { name: `properties:${cradle.config.providers.property}`, status: "up" },
      ],
    };

    return reply.status(db.ok ? 200 : 503).send(body);
  });
};
