import type { ConsoleStreamMessage } from "@agentinmobi/contracts";
import { ValidationError, type AppError } from "../../../../../platform/errors/app-error";
import type { Clock } from "../../../../../platform/clock/clock";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import { err, ok, type Result } from "../../../../../platform/result/result";
import type { ChannelStreamHub } from "../../../application/ports/channel-stream";
import type {
  ChannelAccountView,
  ChatChannel,
  DeliveryReceipt,
  DeliveryStatusUpdate,
  OutboundCommand,
} from "../../../application/ports/chat-channel";
import {
  defaultCapabilities,
  type ChannelCapabilities,
} from "../../../domain/value-objects/channel-capabilities";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import type { InboundMessage } from "../../../domain/value-objects/inbound-message";
import type { ReplyBlock } from "../../../domain/value-objects/reply-block";

/**
 * Canal de consola: hablar con el producto desde la terminal.
 *
 * Existe por una razón de diseño, no de comodidad (docs §13, "orden de
 * implementación consciente"): construir primero un canal trivial obliga a que
 * toda la lógica viva fuera del canal. Cuando llegue WhatsApp en F6, no habrá
 * nada que "sacar" del adaptador porque nunca hubo nada dentro.
 *
 * Capacidades deliberadamente pobres —sin botones, sin tarjetas, sin media—
 * para que la degradación del renderer se ejercite desde el primer día.
 */
export class ConsoleChannel implements ChatChannel {
  readonly type = ChannelType.CONSOLE;

  constructor(
    private readonly deps: { stream: ChannelStreamHub; clock: Clock; ids: IdGenerator },
  ) {}

  capabilities(_account: ChannelAccountView): ChannelCapabilities {
    return defaultCapabilities({
      supportsStreaming: true,
      maxTextLength: 1200,
      maxMessagesPerTurn: 5,
    });
  }

  /** La consola no tiene acuses: el mensaje se ve o no se ve. */
  normalizeStatuses(): readonly DeliveryStatusUpdate[] {
    return [];
  }

  normalizeInbound(
    raw: unknown,
    account: ChannelAccountView,
  ): Result<readonly InboundMessage[], AppError> {
    if (raw === null || typeof raw !== "object") {
      return err(new ValidationError("El cuerpo del mensaje debe ser un objeto"));
    }

    const body = raw as Record<string, unknown>;
    const text = typeof body["text"] === "string" ? body["text"].trim() : "";
    if (text.length === 0) {
      return err(
        new ValidationError("Mensaje sin texto", [{ path: "text", message: "Requerido" }]),
      );
    }

    const from = typeof body["from"] === "string" ? body["from"].trim() : "";
    if (from.length === 0) {
      return err(
        new ValidationError("Falta el remitente", [{ path: "from", message: "Requerido" }]),
      );
    }

    const displayName = typeof body["displayName"] === "string" ? body["displayName"] : undefined;
    // La consola no tiene ids de proveedor: generamos uno estable para que la
    // idempotencia de `conversation` funcione igual que con un webhook real.
    const externalMessageId =
      typeof body["messageId"] === "string" && body["messageId"].length > 0
        ? body["messageId"]
        : `console-${this.deps.ids.generate()}`;

    return ok([
      {
        channelType: this.type,
        channelAccountId: account.id,
        tenantId: account.tenantId,
        externalMessageId,
        externalContactId: from,
        ...(displayName ? { contactDisplayName: displayName } : {}),
        content: [{ kind: "text", text }],
        receivedAt: this.deps.clock.now(),
      },
    ]);
  }

  send(command: OutboundCommand): Promise<Result<DeliveryReceipt, AppError>> {
    const deliveredAt = this.deps.clock.now();

    /*
     * El sobre se comprueba contra el contrato publicado EN TIEMPO DE
     * COMPILACIÓN: renombrar un campo aquí deja de compilar en vez de romper el
     * simulador en silencio. Los bloques quedan fuera del `satisfies` a
     * propósito —el dominio los tiene como array de solo lectura y el contrato
     * no— y sus tipos ya están vigilados por la comprobación de `inbox.routes`.
     */
    const payload = {
      conversationId: command.conversationId,
      messageId: command.messageId,
      to: command.toExternalId,
      blocks: command.blocks,
      sentAt: deliveredAt.toISOString(),
    } satisfies Omit<ConsoleStreamMessage, "blocks"> & { blocks: readonly ReplyBlock[] };

    this.deps.stream.publish(command.account.id, { type: "message", payload });

    // Sin nadie escuchando, el mensaje se da por entregado igualmente: la
    // conversación queda persistida y el cliente la verá al reconectar. Es el
    // mismo comportamiento que tendrá el web chat.
    return Promise.resolve(ok({ providerMessageId: command.messageId, deliveredAt }));
  }
}
