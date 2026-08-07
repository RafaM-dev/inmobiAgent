import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type AppError, toAppError } from "../../platform/errors/app-error";
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

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Ruta no encontrada: ${request.method} ${request.url}`,
        correlationId: request.correlationId,
      },
    });
  });
};
