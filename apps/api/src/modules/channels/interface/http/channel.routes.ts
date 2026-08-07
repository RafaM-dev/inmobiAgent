import type { FastifyInstance } from "fastify";
import { isErr } from "../../../../platform/result/result";
import type { Logger } from "../../../../platform/logging/logger";
import type { ChannelStreamHub } from "../../application/ports/channel-stream";
import type { ReceiveInboundMessageUseCase } from "../../application/use-cases/receive-inbound-message.use-case";
import type { ResolveChannelAccountUseCase } from "../../application/use-cases/resolve-channel-account.use-case";
import { parseChannelType } from "../../domain/value-objects/channel-type";
import { NotFoundError } from "../../../../platform/errors/app-error";

interface ChannelParams {
  channelType: string;
  accountExternalId: string;
}

/**
 * Transporte HTTP de los canales "de cliente": aquellos cuyo destinatario está
 * conectado a nuestra propia API (consola hoy, web chat en F7).
 *
 * Las rutas son genéricas por diseño: `:channelType` es un parámetro, no una
 * ruta por canal. Ningún archivo de esta capa menciona un proveedor concreto.
 * Los canales *de proveedor* (WhatsApp, F6) entrarán por `/webhooks/:channel/…`
 * con verificación de firma, y reutilizarán exactamente el mismo caso de uso.
 */
export const registerChannelRoutes = (
  app: FastifyInstance,
  deps: {
    receiveInbound: ReceiveInboundMessageUseCase;
    resolveAccount: ResolveChannelAccountUseCase;
    stream: ChannelStreamHub;
    logger: Logger;
  },
): void => {
  /** Entrada de mensajes del cliente. Responde rápido: el trabajo va por eventos. */
  app.post<{ Params: ChannelParams }>(
    "/api/channels/:channelType/:accountExternalId/messages",
    async (request, reply) => {
      const channelType = parseChannelType(request.params.channelType);
      if (!channelType) throw new NotFoundError("Canal", request.params.channelType);

      const result = await deps.receiveInbound.execute({
        channelType,
        channelExternalId: request.params.accountExternalId,
        raw: request.body,
        correlationId: request.correlationId,
      });

      // El error-handler global traduce el AppError a su estado HTTP.
      if (isErr(result)) throw result.error;

      return reply.status(202).send({
        accepted: true,
        externalMessageIds: result.value.externalMessageIds,
      });
    },
  );

  /**
   * Flujo de salida en vivo (SSE).
   *
   * Se escribe sobre `reply.raw` porque Fastify no debe serializar ni cerrar la
   * respuesta: es un flujo de larga duración, no una respuesta puntual.
   */
  app.get<{ Params: ChannelParams }>(
    "/api/channels/:channelType/:accountExternalId/stream",
    async (request, reply) => {
      const channelType = parseChannelType(request.params.channelType);
      if (!channelType) throw new NotFoundError("Canal", request.params.channelType);

      const account = await deps.resolveAccount.execute(
        channelType,
        request.params.accountExternalId,
      );
      if (isErr(account)) throw account.error;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const write = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      write("ready", {
        channelAccountId: account.value.id,
        channelType: account.value.channelType,
        displayName: account.value.displayName,
      });

      const unsubscribe = deps.stream.subscribe(account.value.id, (event) => {
        write(event.type, event.payload);
      });

      // Sin latidos, un proxy intermedio corta la conexión por inactividad.
      const heartbeat = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 20_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        deps.logger.debug("Cliente de streaming desconectado", {
          channelAccountId: account.value.id,
        });
      });

      // La promesa no se resuelve: la petición vive hasta que el cliente cierre.
      return reply;
    },
  );
};
