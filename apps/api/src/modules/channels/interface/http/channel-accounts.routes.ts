import type { ChannelAccountListResponse } from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isErr } from "../../../../platform/result/result";
import type { ListChannelAccountsUseCase } from "../../application/use-cases/list-channel-accounts.use-case";

export interface ChannelAccountsRoutesDeps {
  listAccounts: ListChannelAccountsUseCase;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) => void;
}

/**
 * Canales conectados, para el back-office.
 *
 * Va en un archivo aparte de `channel.routes.ts` porque son dos superficies
 * distintas con dos públicos distintos: aquella la usan los clientes finales y
 * no lleva sesión; esta la usa el asesor y exige cookie. Mezclarlas invitaría
 * a que un día alguien añada una ruta de asesor sin guardia por estar rodeada
 * de rutas públicas.
 *
 * Es además lo que hace posible el simulador: el navegador pregunta cuál es la
 * cuenta de consola de su inmobiliaria y después habla con ella **por la misma
 * ruta pública que usaría un cliente**. Lo que se prueba es el camino real, no
 * un atajo interno que se comporta distinto.
 */
export const registerChannelAccountsRoutes = (
  app: FastifyInstance,
  deps: ChannelAccountsRoutesDeps,
): void => {
  app.get("/api/channels/accounts", { preHandler: deps.requireSession }, async (_req, reply) => {
    const result = await deps.listAccounts.execute();
    if (isErr(result)) throw result.error;

    const body: ChannelAccountListResponse = {
      items: result.value.map((account) => ({
        id: account.id,
        channelType: account.channelType,
        externalId: account.externalId,
        displayName: account.displayName,
        isActive: account.isActive,
      })),
    };
    return reply.send(body);
  });
};
