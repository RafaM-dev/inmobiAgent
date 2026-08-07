import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { EventSubscription } from "../../platform/events/event";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { ChannelsCradle } from "../channels";
import { requireSession, type IdentityCradle } from "../identity";
import { onInboundMessageReceived } from "./application/event-handlers/on-inbound-message-received";
import { onMessagePersisted } from "./application/event-handlers/on-message-persisted";
import type { InboxStreamHub } from "./application/ports/inbox-stream";
import { GetConversationThreadUseCase } from "./application/use-cases/get-conversation-thread.use-case";
import { ListInboxUseCase } from "./application/use-cases/list-inbox.use-case";
import { SendHumanMessageUseCase } from "./application/use-cases/send-human-message.use-case";
import type { InboxQuery } from "./domain/repositories/inbox.query";
import { PrismaInboxQuery } from "./infrastructure/persistence/prisma/prisma-inbox.query";
import { InMemoryInboxStreamHub } from "./infrastructure/stream/in-memory-inbox-stream.hub";
import { registerInboxRoutes } from "./interface/http/inbox.routes";
import type { ConversationService } from "./application/ports/conversation-service";
import type { TurnScheduler } from "./application/ports/turn-scheduler";
import { ConversationServiceFacade } from "./application/services/conversation-service.facade";
import { AppendOutboundMessageUseCase } from "./application/use-cases/append-outbound-message.use-case";
import { FlushTurnUseCase } from "./application/use-cases/flush-turn.use-case";
import { GetConversationContextUseCase } from "./application/use-cases/get-conversation-context.use-case";
import { IngestInboundMessageUseCase } from "./application/use-cases/ingest-inbound-message.use-case";
import { SetConversationControlUseCase } from "./application/use-cases/set-conversation-control.use-case";
import { UpdateContactProfileUseCase } from "./application/use-cases/update-contact-profile.use-case";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationLock,
  ConversationRepository,
  MessageRepository,
} from "./domain/repositories/conversation.repositories";
import { PostgresConversationLock } from "./infrastructure/persistence/prisma/postgres-conversation.lock";
import {
  PrismaContactProfileRepository,
  PrismaContactRepository,
  PrismaConversationRepository,
  PrismaMessageRepository,
} from "./infrastructure/persistence/prisma/prisma-conversation.repositories";
import { InProcessTurnScheduler } from "./infrastructure/turn/in-process-turn-scheduler";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `conversation`
 * ========================================================================== */

export type { ConversationService } from "./application/ports/conversation-service";
export type { ConversationContext, ContextMessage } from "./application/use-cases/get-conversation-context.use-case";
export type { AppendOutboundMessageCommand } from "./application/use-cases/append-outbound-message.use-case";
export type { UpdateContactProfileCommand } from "./application/use-cases/update-contact-profile.use-case";
export {
  ConversationStarted,
  ConversationClosed,
  ConversationIdle,
  MessagePersisted,
  TurnReady,
  type ConversationStartedPayload,
  type TurnReadyPayload,
  type MessagePersistedPayload,
} from "./application/events/conversation.events";
export {
  ConversationStage,
  ConversationStatus,
} from "./domain/entities/conversation";
export { MessageAuthorType, MessageDirection } from "./domain/entities/message";
export {
  REQUIRED_SLOTS,
  type ProfileSlots,
  type ProfileSlotName,
  type ProfileChange,
} from "./domain/entities/contact-profile";
export { SlotSource, slot, type ProfileSlot } from "./domain/value-objects/profile-slot";
export {
  PropertyKind,
  PropertyOperation,
  Timeline,
  Financing,
  moneyFromMajor,
  moneyToMajor,
  type MoneyRange,
  type NumberRange,
} from "./domain/value-objects/preferences";

export interface ConversationCradle {
  contactRepository: ContactRepository;
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  contactProfileRepository: ContactProfileRepository;
  conversationLock: ConversationLock;
  turnScheduler: TurnScheduler;
  inboxQuery: InboxQuery;
  inboxStream: InboxStreamHub;

  listInbox: ListInboxUseCase;
  getConversationThread: GetConversationThreadUseCase;
  sendHumanMessage: SendHumanMessageUseCase;

  ingestInboundMessage: IngestInboundMessageUseCase;
  flushTurn: FlushTurnUseCase;
  appendOutboundMessage: AppendOutboundMessageUseCase;
  getConversationContext: GetConversationContextUseCase;
  updateContactProfile: UpdateContactProfileUseCase;
  setConversationControl: SetConversationControlUseCase;

  /** Puerto público: es lo que consumirá el agente en F2. */
  conversationService: ConversationService;
}

type Cradle = PlatformCradle & IdentityCradle & ChannelsCradle & ConversationCradle;

export const conversationModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "conversation",

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      contactRepository: asFunction(
        (c: Cradle): ContactRepository => new PrismaContactRepository(c.database, c.ids),
      ).singleton(),

      conversationRepository: asFunction(
        (c: Cradle): ConversationRepository => new PrismaConversationRepository(c.database),
      ).singleton(),

      messageRepository: asFunction(
        (c: Cradle): MessageRepository => new PrismaMessageRepository(c.database),
      ).singleton(),

      contactProfileRepository: asFunction(
        (c: Cradle): ContactProfileRepository =>
          new PrismaContactProfileRepository(c.database, c.ids),
      ).singleton(),

      conversationLock: asFunction(
        (c: Cradle): ConversationLock =>
          new PostgresConversationLock(c.database, c.logger.child({ module: "conversation" })),
      ).singleton(),

      /**
       * El planificador solo sabe *cuándo* cerrar el turno; *qué* hacer al
       * cerrarlo es `FlushTurnUseCase`. Sustituirlo por pg-boss en F2 no toca
       * ni una línea de lógica.
       */
      turnScheduler: asFunction((c: Cradle): TurnScheduler => {
        const flushTurn = c.flushTurn;
        return new InProcessTurnScheduler({
          runTurn: async (command) => {
            await flushTurn.execute(command.conversationId);
          },
          clock: c.clock,
          logger: c.logger.child({ module: "conversation", component: "turn-scheduler" }),
          options: {
            debounceMs: c.config.agent.turnDebounceMs,
            maxWaitMs: c.config.agent.turnDebounceMaxMs,
          },
        });
      }).singleton(),

      ingestInboundMessage: asFunction(
        (c: Cradle) =>
          new IngestInboundMessageUseCase({
            contacts: c.contactRepository,
            conversations: c.conversationRepository,
            messages: c.messageRepository,
            profiles: c.contactProfileRepository,
            turnScheduler: c.turnScheduler,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
            logger: c.logger.child({ module: "conversation" }),
          }),
      ).singleton(),

      flushTurn: asFunction(
        (c: Cradle) =>
          new FlushTurnUseCase({
            conversations: c.conversationRepository,
            messages: c.messageRepository,
            lock: c.conversationLock,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            ids: c.ids,
            logger: c.logger.child({ module: "conversation" }),
          }),
      ).singleton(),

      appendOutboundMessage: asFunction(
        (c: Cradle) =>
          new AppendOutboundMessageUseCase({
            conversations: c.conversationRepository,
            messages: c.messageRepository,
            dispatcher: c.replyDispatcher,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
          }),
      ).singleton(),

      getConversationContext: asFunction(
        (c: Cradle) =>
          new GetConversationContextUseCase({
            conversations: c.conversationRepository,
            contacts: c.contactRepository,
            messages: c.messageRepository,
            profiles: c.contactProfileRepository,
          }),
      ).singleton(),

      updateContactProfile: asFunction(
        (c: Cradle) =>
          new UpdateContactProfileUseCase({
            profiles: c.contactProfileRepository,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
          }),
      ).singleton(),

      setConversationControl: asFunction(
        (c: Cradle) =>
          new SetConversationControlUseCase({
            conversations: c.conversationRepository,
            turnScheduler: c.turnScheduler,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      inboxQuery: asFunction((c: Cradle): InboxQuery => new PrismaInboxQuery(c.database)).singleton(),

      inboxStream: asFunction((): InboxStreamHub => new InMemoryInboxStreamHub()).singleton(),

      listInbox: asFunction((c: Cradle) => new ListInboxUseCase({ inbox: c.inboxQuery })).singleton(),

      getConversationThread: asFunction(
        (c: Cradle) =>
          new GetConversationThreadUseCase({
            conversations: c.conversationRepository,
            contacts: c.contactRepository,
            messages: c.messageRepository,
            profiles: c.contactProfileRepository,
          }),
      ).singleton(),

      sendHumanMessage: asFunction(
        (c: Cradle) =>
          new SendHumanMessageUseCase({
            conversations: c.conversationRepository,
            appendOutbound: c.appendOutboundMessage,
            setControl: c.setConversationControl,
            logger: c.logger.child({ module: "conversation" }),
          }),
      ).singleton(),

      conversationService: asFunction(
        (c: Cradle): ConversationService =>
          new ConversationServiceFacade({
            getContext: c.getConversationContext,
            appendOutbound: c.appendOutboundMessage,
            updateProfile: c.updateContactProfile,
            setControl: c.setConversationControl,
          }),
      ).singleton(),
    });
  },

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerInboxRoutes(app, {
      listInbox: cradle.listInbox,
      getThread: cradle.getConversationThread,
      sendHumanMessage: cradle.sendHumanMessage,
      setControl: cradle.setConversationControl,
      stream: cradle.inboxStream,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
      logger: cradle.logger.child({ module: "conversation" }),
    });
  },

  registerSubscriptions(cradle: Cradle): EventSubscription[] {
    return [
      onInboundMessageReceived({
        ingest: cradle.ingestInboundMessage,
        logger: cradle.logger.child({ module: "conversation" }),
      }),
      onMessagePersisted({
        messages: cradle.messageRepository,
        stream: cradle.inboxStream,
      }),
    ];
  },

  /** Al apagar, se cierran los turnos pendientes en vez de perderlos. */
  async onStop(cradle: Cradle): Promise<void> {
    await cradle.turnScheduler.flushAll();
  },
};
