import {
  connectWhatsAppRequestSchema,
  type ChannelAccountListResponse,
  type ConnectChannelResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import { WHATSAPP_CREDENTIAL_KEYS } from "../../application/ports/channel-credentials";
import type { ChannelRegistry } from "../../application/ports/chat-channel";
import type { ConnectChannelAccountUseCase } from "../../application/use-cases/connect-channel-account.use-case";
import type { ListChannelAccountsUseCase } from "../../application/use-cases/list-channel-accounts.use-case";
import { ChannelType } from "../../domain/value-objects/channel-type";

type Guard = (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) => void;

export interface ChannelAccountsRoutesDeps {
  listAccounts: ListChannelAccountsUseCase;
  connectAccount: ConnectChannelAccountUseCase;
  channels: ChannelRegistry;
  requireSession: Guard;
  requireAdmin: Guard;
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
      available: [...deps.channels.available()],
    };
    return reply.send(body);
  });

  /**
   * Alta de un número de WhatsApp.
   *
   * La ruta es específica del canal —y no un `POST /api/channels/accounts`
   * genérico— porque el CUERPO lo es: cada proveedor pide credenciales
   * distintas. Un endpoint genérico con un `credentials` abierto aceptaría
   * cualquier diccionario y trasladaría al navegador la responsabilidad de
   * saber qué claves espera cada adaptador. Aquí el contrato es explícito y el
   * caso de uso que hay detrás sigue siendo genérico.
   *
   * Solo OWNER y ADMIN: conectar una línea decide por dónde habla la
   * inmobiliaria con todos sus clientes.
   */
  app.post(
    "/api/channels/whatsapp",
    { preHandler: [deps.requireSession, deps.requireAdmin] },
    async (request, reply) => {
      const parsed = connectWhatsAppRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Datos de conexión inválidos",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      const result = await deps.connectAccount.execute({
        channelType: ChannelType.WHATSAPP,
        externalId: parsed.data.phoneNumberId,
        displayName: parsed.data.displayName,
        // Traducir del contrato público a las claves del adaptador ocurre
        // AQUÍ, en el borde. El caso de uso no sabe cómo se llaman.
        credentials: { [WHATSAPP_CREDENTIAL_KEYS.accessToken]: parsed.data.accessToken },
      });
      if (isErr(result)) throw result.error;

      const body: ConnectChannelResponse = {
        account: {
          id: result.value.account.id,
          channelType: result.value.account.channelType,
          externalId: result.value.account.externalId,
          displayName: result.value.account.displayName,
          isActive: result.value.account.isActive,
        },
        verified: result.value.verified,
        ...(result.value.verificationMessage !== undefined
          ? { verificationMessage: result.value.verificationMessage }
          : {}),
      };

      // 200 y no 201: la operación es idempotente. Volver a enviar el mismo
      // número con un token nuevo lo ROTA, no crea una segunda cuenta, y
      // responder "created" a eso sería mentir la mitad de las veces.
      return reply.send(body);
    },
  );
};
