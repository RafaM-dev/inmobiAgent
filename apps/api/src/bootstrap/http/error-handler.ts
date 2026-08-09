import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RateLimitedError, type AppError, toAppError } from "../../platform/errors/app-error";
import type { Logger } from "../../platform/logging/logger";

/**
 * Traducción única de errores a respuestas HTTP.
 *
 * Reglas:
 *  - El cliente recibe siempre la misma forma (`contracts/apiErrorSchema`).
 *  - Los errores no operacionales (bugs) nunca filtran su mensaje al cliente:
 *    se registran completos y se responden como "error interno".
 *  - Cada respuesta lleva el `correlationId` para poder rastrearla en los logs.
 */
export const registerErrorHandler = (app: FastifyInstance, logger: Logger): void => {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = request.correlationId;

    // Errores de validación del propio Fastify.
    const fastifyError = error as { statusCode?: number; validation?: unknown; message?: string };
    if (fastifyError.validation) {
      void reply.status(400).send({
        error: {
          code: "VALIDATION",
          message: "Petición inválida",
          correlationId,
        },
      });
      return;
    }

    const appError: AppError = toAppError(error);

    const logFields = {
      err: { name: appError.name, message: appError.message, stack: appError.stack },
      code: appError.code,
      method: request.method,
      url: request.url,
      ...(appError.context ?? {}),
    };

    if (appError.operational) {
      logger.warn("Error operacional atendido", logFields);

      /*
       * `Retry-After` no es cosmético: es lo que convierte un 429 en un aplazo
       * en vez de una pérdida. Los proveedores de canal lo respetan, así que
       * decir cuándo volver es lo que hace que el mensaje del cliente llegue
       * más tarde en lugar de no llegar nunca. Va en segundos porque el
       * estándar es así (RFC 9110), redondeando siempre hacia arriba: volver
       * medio segundo antes de tiempo sería otro rechazo.
       */
      if (appError instanceof RateLimitedError) {
        void reply.header("Retry-After", String(Math.ceil(appError.retryAfterMs / 1000)));
      }

      void reply.status(appError.httpStatus).send(appError.toPublicJSON(correlationId));
      return;
    }

    logger.error("Error no controlado", logFields);
    void reply.status(500).send({
      error: {
        code: "INTERNAL",
        message: "Error interno del servidor",
        correlationId,
      },
    });
  });

  /*
   * El 404 NO se registra aquí: vive en `not-found.ts`, porque en producción
   * deja de ser siempre un error —una URL como `/leads` es una ruta del panel—
   * y esa decisión depende de si este proceso sirve o no el navegador (D84).
   */
};
