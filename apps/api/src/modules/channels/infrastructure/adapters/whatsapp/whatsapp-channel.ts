import type { Clock } from "../../../../../platform/clock/clock";
import { ValidationError, type AppError } from "../../../../../platform/errors/app-error";
import type { Logger } from "../../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../../platform/result/result";
import {
  WHATSAPP_CREDENTIAL_KEYS,
  type ChannelCredentials,
} from "../../../application/ports/channel-credentials";
import type {
  ChannelAccountView,
  ChatChannel,
  DeliveryReceipt,
  DeliveryStatusUpdate,
  OutboundCommand,
} from "../../../application/ports/chat-channel";
import type { ChannelCapabilities } from "../../../domain/value-objects/channel-capabilities";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import type { InboundMessage } from "../../../domain/value-objects/inbound-message";
import { toDeliveryStatuses, toInboundMessages } from "./inbound.mapper";
import { toWhatsAppMessages } from "./outbound.mapper";
import { whatsAppCapabilities } from "./whatsapp-capabilities";
import type { WhatsAppClient } from "./whatsapp.client";
import type { WhatsAppWebhookPayload } from "./whatsapp.types";

/**
 * Canal de WhatsApp.
 *
 * Todo lo que sabe de Meta lo delega en los mapeadores puros de al lado; aquí
 * solo queda la coreografía: pedir credenciales, traducir, enviar en orden.
 *
 * Fíjate en lo que NO hay: ni una regla de negocio, ni una mención a leads,
 * citas o inmuebles. Es la prueba de que el principio 2 se sostuvo cinco fases
 * — no hubo nada que sacar del canal porque nunca hubo nada dentro.
 *
 * **Ventana de 24 horas**: no se adivina. WhatsApp rechaza el envío con el
 * código 131047 y el cliente lo traduce a un error legible. Enforzarlo por
 * nuestra cuenta exigiría llevar un registro paralelo del último mensaje de
 * cada cliente que, si se desincroniza, deja de responder en silencio — que es
 * mucho peor que un error explícito del proveedor.
 */
export class WhatsAppChannel implements ChatChannel {
  readonly type = ChannelType.WHATSAPP;

  constructor(
    private readonly deps: {
      client: WhatsAppClient;
      credentials: ChannelCredentials;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  capabilities(_account: ChannelAccountView): ChannelCapabilities {
    return whatsAppCapabilities();
  }

  normalizeInbound(
    raw: unknown,
    account: ChannelAccountView,
  ): Result<readonly InboundMessage[], AppError> {
    if (raw === null || typeof raw !== "object") {
      return err(new ValidationError("El cuerpo del webhook debe ser un objeto"));
    }

    return ok(toInboundMessages(raw as WhatsAppWebhookPayload, account, this.deps.clock.now()));
  }

  normalizeStatuses(raw: unknown, _account: ChannelAccountView): readonly DeliveryStatusUpdate[] {
    if (raw === null || typeof raw !== "object") return [];
    return toDeliveryStatuses(raw, this.deps.clock.now());
  }

  /**
   * Comprueba el par (número, token) contra Meta al conectar la línea.
   *
   * Aquí sí se mira `accessToken` antes de llamar: un token vacío no merece un
   * viaje a la red, y el mensaje "falta el token" es más útil que el 401 que
   * devolvería Meta.
   */
  async verifyCredentials(input: {
    externalId: string;
    credentials: Readonly<Record<string, string>>;
  }): Promise<Result<void, AppError>> {
    const accessToken = input.credentials[WHATSAPP_CREDENTIAL_KEYS.accessToken];
    if (!accessToken) {
      return err(new ValidationError("Falta el token de acceso"));
    }

    return this.deps.client.verify({ phoneNumberId: input.externalId, accessToken });
  }

  async send(command: OutboundCommand): Promise<Result<DeliveryReceipt, AppError>> {
    const credentials = await this.deps.credentials.get(command.account.id);
    if (isErr(credentials)) return credentials;

    const accessToken = credentials.value[WHATSAPP_CREDENTIAL_KEYS.accessToken];
    if (!accessToken) {
      return err(
        new ValidationError("La cuenta de WhatsApp no tiene token de acceso configurado"),
      );
    }

    const messages = toWhatsAppMessages(command.blocks, command.toExternalId);
    if (messages.length === 0) {
      return err(new ValidationError("No hay nada que enviar"));
    }

    const providerMessageIds: string[] = [];

    // En serie y no en paralelo: WhatsApp entrega en el orden en que recibe, y
    // mandar la ficha antes que la frase que la presenta se lee fatal.
    for (const message of messages) {
      const sent = await this.deps.client.send({
        // El `phone_number_id` de Meta ES el identificador externo de la cuenta.
        phoneNumberId: command.account.externalId,
        accessToken,
        message,
      });

      if (isErr(sent)) {
        if (providerMessageIds.length > 0) {
          // Entrega parcial: el cliente ya vio parte de la respuesta. Se
          // registra para poder diagnosticarlo, porque a ojos del cliente la
          // conversación quedó cortada a la mitad.
          this.deps.logger.warn("Respuesta entregada a medias", {
            conversationId: command.conversationId,
            messageId: command.messageId,
            enviados: providerMessageIds.length,
            total: messages.length,
          });
        }
        return sent;
      }

      if (sent.value.providerMessageId) providerMessageIds.push(sent.value.providerMessageId);
    }

    return ok({
      ...(providerMessageIds[0] !== undefined
        ? { providerMessageId: providerMessageIds[0] }
        : {}),
      ...(providerMessageIds.length > 0 ? { providerMessageIds } : {}),
      deliveredAt: this.deps.clock.now(),
    });
  }
}
