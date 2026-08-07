import type { UsageSummary } from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GetUsageSummaryUseCase } from "../../application/use-cases/get-usage-summary.use-case";
import { isErr } from "../../../../platform/result/result";

export interface UsageRoutesDeps {
  getUsage: GetUsageSummaryUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/**
 * Consumo del periodo en curso.
 *
 * Vive en `agent` y no en `identity` porque el contador es suyo, y `agent` ya
 * depende de `identity`: la ruta al revés cerraría un ciclo entre módulos. Es
 * la misma decisión que llevó los canales fuera de `/api/settings` (D38).
 *
 * Sin este dato, el tope de gasto es un número que se configura a ciegas: nadie
 * sabe si 50 dólares al mes le sobran o se le quedan cortos hasta que el agente
 * deja de responder.
 */
export const registerUsageRoutes = (app: FastifyInstance, deps: UsageRoutesDeps): void => {
  app.get("/api/usage", { preHandler: deps.requireSession }, async (_request, reply) => {
    const result = await deps.getUsage.execute();
    if (isErr(result)) throw result.error;

    const body: UsageSummary = result.value;
    return reply.send(body);
  });
};
