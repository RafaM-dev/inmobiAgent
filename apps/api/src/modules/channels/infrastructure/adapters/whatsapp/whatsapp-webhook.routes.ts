import type { FastifyInstance } from "fastify";
import type { Logger } from "../../../../../platform/logging/logger";
import { isErr } from "../../../../../platform/result/result";
import type { ApplyDeliveryStatusUseCase } from "../../../application/use-cases/apply-delivery-status.use-case";
import type { ReceiveInboundMessageUseCase } from "../../../application/use-cases/receive-inbound-message.use-case";
import type { ResolveChannelAccountUseCase } from "../../../application/use-cases/resolve-channel-account.use-case";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import { splitByPhoneNumber, toDeliveryStatuses } from "./inbound.mapper";
import { resolveVerificationChallenge, verifyWebhookSignature } from "./webhook-signature";
import type { WhatsAppWebhookPayload } from "./whatsapp.types";

interface VerifyQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface WhatsAppWebhookDeps {
  receiveInbound: ReceiveInboundMessageUseCase;
  resolveAccount: ResolveChannelAccountUseCase;
  applyDeliveryStatus: ApplyDeliveryStatusUseCase;
  appSecret: string;
  verifyToken: string;
  logger: Logger;
}

/**
 * Webhook de WhatsApp.
 *
 * Una sola URL para toda la plataforma: Meta entrega ahí los eventos de todos
 * los números de la app, así que lo primero que se hace tras verificar la firma
 * es repartir el payload por número —y con él, por inmobiliaria—.
 *
 * Tres decisiones que importan:
 *
 * 1. **El cuerpo se lee CRUDO.** La firma se calcula sobre los bytes exactos;
 *    parsear y volver a serializar cambia el formato y la firma deja de
 *    coincidir de forma intermitente. Por eso estas rutas van en un contexto
 *    encapsulado con su propio parser.
 *
 * 2. **Sin firma válida, 403 y nada más.** La URL es pública; la firma es lo
 *    único que distingue a Meta de cualquiera.
 *
 * 3. **Siempre se responde 200 tras verificar.** Si devolviéramos 500 por un
 *    fallo nuestro, Meta reintentaría en bucle y acabaría desactivando el
 *    webhook — y entonces dejarían de llegar los mensajes de todos los
 *    clientes. El trabajo real ya va por eventos; lo que falle aquí se
 *    registra y se reintenta por nuestros medios, no por los suyos.
 */
export const registerWhatsAppWebhookRoutes = (
  app: FastifyInstance,
  deps: WhatsAppWebhookDeps,
): void => {
  void app.register((instance, _options, done) => {
    /*
     * Parser propio: se queda con el cuerpo crudo y además lo entrega parseado.
     *
     * `parseAs: "buffer"` y NO `"string"`. Con `string`, Fastify compara la
     * longitud en CARACTERES contra el `Content-Length`, que va en BYTES, y
     * cualquier mensaje con una tilde —es decir, cualquier mensaje en
     * español— falla con "Request body size did not match Content-Length".
     * Se detectó enviando "acompaño" desde el back-office.
     */
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body: Buffer, next) => {
        const raw = body.toString("utf8");
        (request as { rawBody?: string }).rawBody = raw;

        try {
          next(null, raw.length > 0 ? JSON.parse(raw) : {});
        } catch {
          // Un cuerpo ilegible se deja pasar como objeto vacío: la firma se
          // comprobará igual y responderemos 403 o 200, nunca un 400 que Meta
          // interpretaría como error a reintentar.
          next(null, {});
        }
      },
    );

    /** Alta del webhook. Meta lo llama una sola vez, al configurarlo. */
    instance.get<{ Querystring: VerifyQuery }>("/webhooks/whatsapp", (request, reply) => {
      const challenge = resolveVerificationChallenge({
        mode: request.query["hub.mode"],
        token: request.query["hub.verify_token"],
        challenge: request.query["hub.challenge"],
        expectedToken: deps.verifyToken,
      });

      if (challenge === null) {
        deps.logger.warn("Verificación de webhook rechazada");
        return reply.status(403).send();
      }

      // Meta espera el challenge tal cual, en texto plano.
      return reply.type("text/plain").send(challenge);
    });

    instance.post("/webhooks/whatsapp", async (request, reply) => {
      const rawBody = (request as { rawBody?: string }).rawBody ?? "";

      const signed = verifyWebhookSignature({
        rawBody,
        header: request.headers["x-hub-signature-256"] as string | undefined,
        appSecret: deps.appSecret,
      });

      if (!signed) {
        deps.logger.warn("Webhook con firma inválida descartado", {
          correlationId: request.correlationId,
        });
        return reply.status(403).send();
      }

      const payload = (request.body ?? {}) as WhatsAppWebhookPayload;

      for (const slice of splitByPhoneNumber(payload)) {
        await handleSlice(deps, slice, request.correlationId);
      }

      return reply.status(200).send();
    });

    done();
  });
};

const handleSlice = async (
  deps: WhatsAppWebhookDeps,
  slice: { phoneNumberId: string; payload: WhatsAppWebhookPayload },
  correlationId: string,
): Promise<void> => {
  const received = await deps.receiveInbound.execute({
    channelType: ChannelType.WHATSAPP,
    channelExternalId: slice.phoneNumberId,
    raw: slice.payload,
    correlationId,
  });

  if (isErr(received)) {
    // Número que no es de ninguna inmobiliaria nuestra, tenant suspendido o
    // cuenta desactivada. No es un error del proveedor: se registra y ya.
    deps.logger.warn("Webhook de WhatsApp no procesado", {
      phoneNumberId: slice.phoneNumberId,
      errorCode: received.error.code,
    });
    return;
  }

  const statuses = toDeliveryStatuses(slice.payload, new Date());
  if (statuses.length === 0) return;

  const account = await deps.resolveAccount.execute(ChannelType.WHATSAPP, slice.phoneNumberId);
  if (isErr(account)) return;

  await deps.applyDeliveryStatus.execute({
    channelType: ChannelType.WHATSAPP,
    tenantId: account.value.tenantId,
    updates: statuses,
  });
};
