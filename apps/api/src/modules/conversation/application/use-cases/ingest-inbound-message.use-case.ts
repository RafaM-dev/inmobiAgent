import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import { ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ChannelType, InboundContent } from "../../../channels";
import { Contact } from "../../domain/entities/contact";
import { ContactProfile } from "../../domain/entities/contact-profile";
import { Conversation } from "../../domain/entities/conversation";
import { Message } from "../../domain/entities/message";
import type {
  ContactProfileRepository,
  ContactRepository,
  ConversationRepository,
  MessageRepository,
} from "../../domain/repositories/conversation.repositories";
import { ConversationStarted, MessagePersisted } from "../events/conversation.events";
import type { TurnScheduler } from "../ports/turn-scheduler";

export interface IngestInboundMessageCommand {
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly externalMessageId: string;
  readonly externalContactId: string;
  readonly contactDisplayName?: string | undefined;
  readonly content: readonly InboundContent[];
  readonly receivedAt: Date;
}

export interface IngestInboundMessageResult {
  readonly conversationId: string;
  readonly contactId: string;
  readonly messageId: string | null;
  readonly duplicated: boolean;
}

/**
 * Persistencia del mensaje entrante (docs §7.1, pasos 4-7).
 *
 * Cuatro decisiones que merecen quedar explicadas:
 *
 * 1. **Idempotencia primero.** Los proveedores reintentan sus webhooks. Si el
 *    `externalMessageId` ya existe, se descarta en silencio: reintentar no
 *    puede duplicar mensajes ni disparar dos turnos.
 * 2. **Todo en una transacción**, eventos incluidos (outbox). O queda el
 *    mensaje y su evento, o no queda nada.
 * 3. **El turno se agenda DESPUÉS del commit.** Agendarlo dentro haría que el
 *    planificador pudiera leer una conversación que aún no existe.
 * 4. **Aquí no se responde nada.** Este caso de uso no sabe que existe un
 *    agente. Solo deja el mundo en un estado del que otro puede partir.
 */
export class IngestInboundMessageUseCase {
  constructor(
    private readonly deps: {
      contacts: ContactRepository;
      conversations: ConversationRepository;
      messages: MessageRepository;
      profiles: ContactProfileRepository;
      turnScheduler: TurnScheduler;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
    },
  ) {}

  async execute(
    command: IngestInboundMessageCommand,
  ): Promise<Result<IngestInboundMessageResult, AppError>> {
    const context = TenantContext.require();
    const tenantId = context.tenantId;
    const now = this.deps.clock.now();

    const outcome = await this.deps.unitOfWork.run(
      async (): Promise<IngestInboundMessageResult> => {
        const existing = await this.deps.messages.findByExternalId(command.externalMessageId);
        if (existing) {
          this.deps.logger.debug("Mensaje entrante duplicado; se descarta", {
            externalMessageId: command.externalMessageId,
          });
          return {
            conversationId: existing.conversationId,
            contactId: "",
            messageId: null,
            duplicated: true,
          };
        }

        const contact = await this.resolveContact(tenantId, command, now);
        const conversation = await this.resolveConversation(tenantId, contact.id, command, now);

        conversation.registerInbound(now);
        await this.deps.conversations.save(conversation);

        const message = Message.inbound({
          id: this.deps.ids.generate(),
          tenantId,
          conversationId: conversation.id,
          blocks: command.content,
          externalMessageId: command.externalMessageId,
          receivedAt: command.receivedAt,
        });
        await this.deps.messages.save(message);

        await this.deps.events.publish(MessagePersisted, {
          conversationId: conversation.id,
          messageId: message.id,
          direction: "INBOUND",
          authorType: message.authorType,
        });

        return {
          conversationId: conversation.id,
          contactId: contact.id,
          messageId: message.id,
          duplicated: false,
        };
      },
    );

    if (!outcome.duplicated) {
      // Fuera de la transacción: el planificador debe ver datos ya visibles.
      this.deps.turnScheduler.schedule({
        tenantId,
        conversationId: outcome.conversationId,
        correlationId: context.correlationId,
      });
    }

    return ok(outcome);
  }

  private async resolveContact(
    tenantId: string,
    command: IngestInboundMessageCommand,
    now: Date,
  ): Promise<Contact> {
    const existing = await this.deps.contacts.findByChannelIdentity(
      command.channelType,
      command.externalContactId,
    );
    if (existing) {
      // El proveedor puede traer un nombre mejor del que teníamos.
      if (command.contactDisplayName && existing.displayName === "Cliente") {
        existing.rename(command.contactDisplayName, now);
        await this.deps.contacts.save(existing);
      }
      return existing;
    }

    const contact = Contact.create({
      id: this.deps.ids.generate(),
      tenantId,
      displayName: command.contactDisplayName,
      now,
    });
    await this.deps.contacts.save(contact);
    await this.deps.contacts.linkIdentity({
      contactId: contact.id,
      channelType: command.channelType,
      externalId: command.externalContactId,
      displayName: command.contactDisplayName,
    });
    // El perfil nace con el contacto: así nadie tiene que comprobar si existe.
    await this.deps.profiles.save(ContactProfile.empty(tenantId, contact.id, now), []);

    return contact;
  }

  private async resolveConversation(
    tenantId: string,
    contactId: string,
    command: IngestInboundMessageCommand,
    now: Date,
  ): Promise<Conversation> {
    const open = await this.deps.conversations.findOpenByContact(
      contactId,
      command.channelAccountId,
    );
    if (open) return open;

    const conversation = Conversation.start({
      id: this.deps.ids.generate(),
      tenantId,
      contactId,
      channelAccountId: command.channelAccountId,
      channelType: command.channelType,
      externalContactId: command.externalContactId,
      now,
    });
    await this.deps.conversations.save(conversation);

    await this.deps.events.publish(ConversationStarted, {
      conversationId: conversation.id,
      contactId,
      channelType: command.channelType,
      channelAccountId: command.channelAccountId,
    });

    return conversation;
  }
}
