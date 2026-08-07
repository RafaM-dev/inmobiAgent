import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, ForbiddenError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { err, ok, isErr, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantDirectory } from "../../../identity";
import type { ChannelAccountRepository } from "../../domain/repositories/channel-account.repository";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import { toAccountView } from "../mappers/channel-account.mapper";
import type { ChannelRegistry } from "../ports/chat-channel";
import { InboundMessageReceived } from "../events/channels.events";

export interface ReceiveInboundMessageCommand {
  readonly channelType: ChannelType;
  /** Identificador de la cuenta EN EL PROVEEDOR, tal como llega en la URL. */
  readonly channelExternalId: string;
  readonly raw: unknown;
  readonly correlationId: string;
}

export interface ReceiveInboundMessageResult {
  readonly tenantId: string;
  readonly channelAccountId: string;
  /** Un webhook puede traer varios mensajes en una sola llamada. */
  readonly externalMessageIds: readonly string[];
}

/**
 * Entrada al sistema desde cualquier canal (docs §7.1).
 *
 * Tres garantías que no son negociables:
 *
 * 1. El tenant se DEDUCE de la cuenta por la que entró el mensaje, jamás del
 *    payload. Un proveedor comprometido no puede escribir en otra inmobiliaria.
 * 2. A partir del paso 3 todo corre dentro de un `TenantContext`, así que
 *    cualquier repositorio que se toque ya está acotado.
 * 3. Este caso de uso NO persiste la conversación ni responde: solo normaliza y
 *    publica. Así el webhook contesta en milisegundos y el trabajo real ocurre
 *    fuera de la petición del proveedor.
 */
export class ReceiveInboundMessageUseCase {
  constructor(
    private readonly deps: {
      accounts: ChannelAccountRepository;
      channels: ChannelRegistry;
      tenants: TenantDirectory;
      events: EventPublisher;
      unitOfWork: UnitOfWork;
      logger: Logger;
    },
  ) {}

  async execute(
    command: ReceiveInboundMessageCommand,
  ): Promise<Result<ReceiveInboundMessageResult, AppError>> {
    const account = await this.deps.accounts.findByExternalId(
      command.channelType,
      command.channelExternalId,
    );
    if (!account) {
      return err(new NotFoundError("Cuenta de canal", command.channelExternalId));
    }
    if (!account.isActive) {
      return err(new ForbiddenError("La cuenta de canal está desactivada"));
    }

    const channel = this.deps.channels.get(command.channelType);
    if (!channel) {
      return err(new NotFoundError("Canal", command.channelType));
    }

    return TenantContext.run(
      {
        tenantId: account.tenantId,
        correlationId: command.correlationId,
        source: "webhook",
      },
      async (): Promise<Result<ReceiveInboundMessageResult, AppError>> => {
        // Un tenant suspendido no procesa mensajes: falla aquí, antes de crear
        // nada, y con un error que el adaptador puede traducir a un 403.
        await this.deps.tenants.requireActive(account.tenantId);

        const view = toAccountView(account);
        const normalized = channel.normalizeInbound(command.raw, view);
        if (isErr(normalized)) return normalized;

        const messages = normalized.value;

        // Todos los mensajes del lote se publican en la MISMA transacción: si
        // el webhook trae tres y falla el tercero, el proveedor reintentará el
        // lote entero, y la idempotencia por `externalMessageId` se encarga del
        // resto. Publicar a medias dejaría un lote imposible de reintentar.
        await this.deps.unitOfWork.run(async () => {
          for (const message of messages) {
            await this.deps.events.publish(InboundMessageReceived, {
              channelType: message.channelType,
              channelAccountId: message.channelAccountId,
              externalMessageId: message.externalMessageId,
              externalContactId: message.externalContactId,
              ...(message.contactDisplayName
                ? { contactDisplayName: message.contactDisplayName }
                : {}),
              content: message.content,
              receivedAt: message.receivedAt.toISOString(),
            });
          }
        });

        this.deps.logger.debug("Mensajes entrantes aceptados", {
          channelType: command.channelType,
          channelAccountId: account.id,
          count: messages.length,
        });

        return ok({
          tenantId: account.tenantId,
          channelAccountId: account.id,
          externalMessageIds: messages.map((message) => message.externalMessageId),
        });
      },
    );
  }
}
