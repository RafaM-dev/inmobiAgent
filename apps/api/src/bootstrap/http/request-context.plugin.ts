import type { FastifyInstance } from "fastify";
import type { IdGenerator } from "../../platform/ids/id-generator";

declare module "fastify" {
  interface FastifyRequest {
    /** Identificador de traza que viaja por webhook → job → agente → canal. */
    correlationId: string;
  }
}

const CORRELATION_HEADER = "x-correlation-id";

/**
 * Correlación de peticiones.
 *
 * Si el emisor ya trae un `x-correlation-id` (por ejemplo el back-office o un
 * reintento de webhook) lo respetamos; si no, generamos uno. Va de vuelta en la
 * respuesta para que el frontend pueda mostrarlo al reportar una incidencia.
 *
 * El binding del TenantContext se añade en F1, cuando exista resolución de
 * tenant. Aquí solo se establece la traza.
 */
export const registerRequestContext = (app: FastifyInstance, ids: IdGenerator): void => {
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", (request, reply, done) => {
    const incoming = request.headers[CORRELATION_HEADER];
    const correlationId =
      typeof incoming === "string" && incoming.length > 0 ? incoming : ids.generate();

    request.correlationId = correlationId;
    void reply.header(CORRELATION_HEADER, correlationId);
    done();
  });
};
