import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import {
  NotFoundError,
  ForbiddenError,
  RateLimitedError,
  type AppError,
} from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import type { RateLimiter } from "../../../../platform/rate-limit/rate-limiter";
import type { Quota } from "../../../../platform/rate-limit/token-bucket";
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
 * 4. El RITMO se comprueba aquí y no en el servidor HTTP. El límite global de
 *    Fastify cuenta por IP, y por la IP de Meta entran los mensajes de TODAS
 *    las inmobiliarias: cortar ahí castigaría a las demás por el bucle de una.
 *    Solo en este punto se sabe de quién es el tráfico.
 */
export class ReceiveInboundMessageUseCase {
  constructor(
    private readonly deps: {
      accounts: ChannelAccountRepository;
      channels: ChannelRegistry;
      tenants: TenantDirectory;
      events: EventPublisher;
      unitOfWork: UnitOfWork;
      rateLimiter: RateLimiter;
      /** Ritmo tolerado por inmobiliaria. Cuota inactiva = sin límite. */
      messageQuota: Quota;
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

        const throttled = await this.checkRate(account.tenantId, messages.length);
        if (throttled) return err(throttled);

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

  /**
   * Ritmo de entrada de la inmobiliaria.
   *
   * **El lote cuesta lo que trae, no una ficha.** Si un webhook con cincuenta
   * mensajes contara igual que uno con uno, agrupar sería la forma trivial de
   * saltarse el límite, y los proveedores agrupan de serie.
   *
   * Devolver 429 no pierde el mensaje: los proveedores de canal reintentan, y
   * el `Retry-After` les dice cuándo. Frente a la alternativa —aceptar y tirar
   * en silencio— esto aplaza la conversación en lugar de romperla, que es la
   * única degradación aceptable cuando al otro lado hay un cliente esperando.
   *
   * Si el limitador falla, se DEJA PASAR. Misma regla que el tope de gasto: no
   * poder medir el ritmo es un problema nuestro, y convertirlo en una caída del
   * servicio para todas las inmobiliarias sería un problema mucho mayor.
   */
  private async checkRate(tenantId: string, messageCount: number): Promise<AppError | null> {
    if (messageCount === 0) return null;

    try {
      const decision = await this.deps.rateLimiter.consume({
        key: `inbound:${tenantId}`,
        quota: this.deps.messageQuota,
        cost: messageCount,
      });

      if (decision.allowed) return null;

      this.deps.logger.warn("Mensajes entrantes limitados por ritmo", {
        tenantId,
        messageCount,
        retryAfterMs: decision.retryAfterMs,
      });

      return new RateLimitedError("inbound", decision.retryAfterMs);
    } catch (error) {
      this.deps.logger.error("No se pudo medir el ritmo: el lote pasa sin límite", {
        tenantId,
        err: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
