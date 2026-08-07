import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import { requireSession, type IdentityCradle } from "../identity";
import { SecretBox } from "../../platform/crypto/secret-box";
import type { ChannelStreamHub } from "./application/ports/channel-stream";
import type { ChannelCredentials } from "./application/ports/channel-credentials";
import type { ChannelRegistry, ChatChannel } from "./application/ports/chat-channel";
import type { ReplyDispatcher } from "./application/ports/reply-dispatcher";
import { ApplyDeliveryStatusUseCase } from "./application/use-cases/apply-delivery-status.use-case";
import { DispatchReplyUseCase } from "./application/use-cases/dispatch-reply.use-case";
import { GetChannelCapabilitiesUseCase } from "./application/use-cases/get-channel-capabilities.use-case";
import { ReceiveInboundMessageUseCase } from "./application/use-cases/receive-inbound-message.use-case";
import { RegisterChannelAccountUseCase } from "./application/use-cases/register-channel-account.use-case";
import { ListChannelAccountsUseCase } from "./application/use-cases/list-channel-accounts.use-case";
import { ResolveChannelAccountUseCase } from "./application/use-cases/resolve-channel-account.use-case";
import type { ChannelAccountRepository } from "./domain/repositories/channel-account.repository";
import type { ChannelDeliveryRepository } from "./domain/repositories/channel-delivery.repository";
import { ConsoleChannel } from "./infrastructure/adapters/console/console-channel";
import { WhatsAppChannel } from "./infrastructure/adapters/whatsapp/whatsapp-channel";
import {
  GraphWhatsAppClient,
  type WhatsAppClient,
} from "./infrastructure/adapters/whatsapp/whatsapp.client";
import { registerWhatsAppWebhookRoutes } from "./infrastructure/adapters/whatsapp/whatsapp-webhook.routes";
import { PrismaChannelAccountRepository } from "./infrastructure/persistence/prisma/prisma-channel-account.repository";
import { PrismaChannelCredentials } from "./infrastructure/persistence/prisma/prisma-channel-credentials";
import { PrismaChannelDeliveryRepository } from "./infrastructure/persistence/prisma/prisma-channel-delivery.repository";
import { InMemoryChannelRegistry } from "./infrastructure/registry/channel-registry";
import { InMemoryChannelStreamHub } from "./infrastructure/stream/in-memory-channel-stream.hub";
import { registerChannelAccountsRoutes } from "./interface/http/channel-accounts.routes";
import { registerChannelRoutes } from "./interface/http/channel.routes";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `channels`
 *
 * Fuera de aquí no existe el concepto de "proveedor de mensajería". Lo que el
 * resto del sistema ve es: bloques de respuesta, capacidades y un despachador.
 * ========================================================================== */

export type { ReplyDispatcher, DispatchReplyCommand } from "./application/ports/reply-dispatcher";
export type { DeliveryReceipt, ChannelAccountView } from "./application/ports/chat-channel";
export type { RegisterChannelAccountCommand } from "./application/use-cases/register-channel-account.use-case";
export {
  defaultCapabilities,
  type ChannelCapabilities,
} from "./domain/value-objects/channel-capabilities";
export {
  ChannelType,
  parseChannelType,
} from "./domain/value-objects/channel-type";
export type {
  ReplyBlock,
  ReplyBlockKind,
  PropertyCardData,
  QuickReplyOption,
} from "./domain/value-objects/reply-block";
export {
  textBlock,
  quickRepliesBlock,
  linkBlock,
  handoffNoticeBlock,
} from "./domain/value-objects/reply-block";
export type { InboundContent, InboundMessage } from "./domain/value-objects/inbound-message";
export { inboundText } from "./domain/value-objects/inbound-message";
export { blocksToText } from "./domain/value-objects/message-text";
export {
  InboundMessageReceived,
  OutboundMessageDelivered,
  OutboundMessageFailed,
  type InboundMessageReceivedPayload,
  type OutboundMessageDeliveredPayload,
  type OutboundMessageFailedPayload,
} from "./application/events/channels.events";

export interface ChannelsCradle {
  channelAccountRepository: ChannelAccountRepository;
  channelDeliveryRepository: ChannelDeliveryRepository;
  channelCredentials: ChannelCredentials;
  channelStreamHub: ChannelStreamHub;
  channelRegistry: ChannelRegistry;
  whatsAppClient: WhatsAppClient;
  replyDispatcher: ReplyDispatcher;
  receiveInboundMessage: ReceiveInboundMessageUseCase;
  resolveChannelAccount: ResolveChannelAccountUseCase;
  listChannelAccounts: ListChannelAccountsUseCase;
  registerChannelAccount: RegisterChannelAccountUseCase;
  getChannelCapabilities: GetChannelCapabilitiesUseCase;
  applyDeliveryStatus: ApplyDeliveryStatusUseCase;
}

type Cradle = PlatformCradle & IdentityCradle & ChannelsCradle;

export const channelsModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "channels",

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      channelAccountRepository: asFunction(
        (c: Cradle): ChannelAccountRepository => new PrismaChannelAccountRepository(c.database),
      ).singleton(),

      channelStreamHub: asFunction(
        (): ChannelStreamHub => new InMemoryChannelStreamHub(),
      ).singleton(),

      channelDeliveryRepository: asFunction(
        (c: Cradle): ChannelDeliveryRepository =>
          new PrismaChannelDeliveryRepository(c.database, c.ids),
      ).singleton(),

      channelCredentials: asFunction(
        (c: Cradle): ChannelCredentials =>
          new PrismaChannelCredentials(c.database, new SecretBox(c.config.security.encryptionKey)),
      ).singleton(),

      whatsAppClient: asFunction(
        (c: Cradle): WhatsAppClient =>
          new GraphWhatsAppClient({
            options: {
              baseUrl: c.config.whatsapp.graphUrl,
              apiVersion: c.config.whatsapp.apiVersion,
              timeoutMs: c.config.whatsapp.timeoutMs,
            },
            logger: c.logger.child({ module: "channels", channel: "whatsapp" }),
          }),
      ).singleton(),

      /**
       * ÚNICO punto del sistema donde se decide qué canales existen.
       *
       * WhatsApp solo entra si la app de Meta está configurada (decisión D31):
       * un canal registrado sin credenciales aceptaría webhooks que no puede
       * verificar y prometería envíos que no puede hacer. Sin configurar nada,
       * el producto sigue funcionando entero por consola.
       */
      channelRegistry: asFunction((c: Cradle): ChannelRegistry => {
        const channels: ChatChannel[] = [
          new ConsoleChannel({ stream: c.channelStreamHub, clock: c.clock, ids: c.ids }),
        ];

        if (c.config.whatsapp.enabled) {
          channels.push(
            new WhatsAppChannel({
              client: c.whatsAppClient,
              credentials: c.channelCredentials,
              clock: c.clock,
              logger: c.logger.child({ module: "channels", channel: "whatsapp" }),
            }),
          );
        }

        return new InMemoryChannelRegistry(channels);
      }).singleton(),

      replyDispatcher: asFunction(
        (c: Cradle): ReplyDispatcher =>
          new DispatchReplyUseCase({
            accounts: c.channelAccountRepository,
            channels: c.channelRegistry,
            deliveries: c.channelDeliveryRepository,
            events: c.eventPublisher,
            logger: c.logger.child({ module: "channels" }),
          }),
      ).singleton(),

      applyDeliveryStatus: asFunction(
        (c: Cradle) =>
          new ApplyDeliveryStatusUseCase({
            deliveries: c.channelDeliveryRepository,
            events: c.eventPublisher,
            logger: c.logger.child({ module: "channels" }),
          }),
      ).singleton(),

      receiveInboundMessage: asFunction(
        (c: Cradle) =>
          new ReceiveInboundMessageUseCase({
            accounts: c.channelAccountRepository,
            channels: c.channelRegistry,
            tenants: c.tenantDirectory,
            events: c.eventPublisher,
            unitOfWork: c.unitOfWork,
            logger: c.logger.child({ module: "channels" }),
          }),
      ).singleton(),

      resolveChannelAccount: asFunction(
        (c: Cradle) => new ResolveChannelAccountUseCase({ accounts: c.channelAccountRepository }),
      ).singleton(),

      listChannelAccounts: asFunction(
        (c: Cradle) => new ListChannelAccountsUseCase({ accounts: c.channelAccountRepository }),
      ).singleton(),

      getChannelCapabilities: asFunction(
        (c: Cradle) =>
          new GetChannelCapabilitiesUseCase({
            accounts: c.channelAccountRepository,
            channels: c.channelRegistry,
          }),
      ).singleton(),

      registerChannelAccount: asFunction(
        (c: Cradle) =>
          new RegisterChannelAccountUseCase({
            accounts: c.channelAccountRepository,
            clock: c.clock,
            ids: c.ids,
          }),
      ).singleton(),
    });
  },

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerChannelRoutes(app, {
      receiveInbound: cradle.receiveInboundMessage,
      resolveAccount: cradle.resolveChannelAccount,
      stream: cradle.channelStreamHub,
      logger: cradle.logger.child({ module: "channels" }),
    });

    registerChannelAccountsRoutes(app, {
      listAccounts: cradle.listChannelAccounts,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
    });

    if (cradle.config.whatsapp.enabled) {
      registerWhatsAppWebhookRoutes(app, {
        receiveInbound: cradle.receiveInboundMessage,
        resolveAccount: cradle.resolveChannelAccount,
        applyDeliveryStatus: cradle.applyDeliveryStatus,
        appSecret: cradle.config.whatsapp.appSecret,
        verifyToken: cradle.config.whatsapp.verifyToken,
        logger: cradle.logger.child({ module: "channels", channel: "whatsapp" }),
      });
    }
  },
};
