import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { isErr, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ConversationContext, ConversationService } from "../../../conversation";
import { Lead } from "../../domain/entities/lead";
import type { LeadRepository } from "../../domain/repositories/lead.repository";
import { mergeRequirements } from "../../domain/value-objects/lead-requirements";
import { LeadCaptured } from "../events/leads.events";
import { hasName, toLeadRequirements } from "../mappers/profile-to-requirements.mapper";
import type { CaptureLeadCommand, LeadView } from "../ports/lead-service";
import type { LeadQualifier } from "../services/lead-qualifier";

/**
 * `CaptureLead` — convertir una conversación en una ficha comercial.
 *
 * **Idempotente por conversación** (docs §6). Es la propiedad que lo hace
 * seguro: el agente puede llamar a `register_lead` cinco veces en un turno, el
 * cliente puede volver mañana sobre la misma conversación y el evento
 * `catalog.property_shown` puede entregarse dos veces — siempre hay un lead, no
 * seis. Sin esto, un CRM se llena de duplicados en una semana.
 *
 * Los requisitos NO se los inventa quien llama: se leen de la memoria de la
 * conversación, que es donde vive lo que el cliente dijo de verdad. El comando
 * solo puede añadir por encima.
 */
export class CaptureLeadUseCase {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      conversations: ConversationService;
      qualifier: LeadQualifier;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(command: CaptureLeadCommand): Promise<Result<LeadView, AppError>> {
    const contextResult = await this.deps.conversations.getContext(command.conversationId);
    if (isErr(contextResult)) return contextResult;
    const context = contextResult.value;

    const existing = await this.deps.leads.findByConversation(command.conversationId);

    // Un lead ganado o perdido no se reabre desde una conversación: sería
    // reescribir un resultado comercial ya cerrado. Reabrir es una decisión del
    // asesor, y llegará con el back-office (F7).
    if (existing && !existing.isOpen) return ok(toView(existing, false));

    const lead = existing ?? this.newLead(command, context);
    const created = existing === null;

    const now = this.deps.clock.now();

    // La memoria manda; el comando puede completar, nunca contradecir en bloque.
    const requirements = mergeRequirements(
      toLeadRequirements(context.profile),
      command.requirements ?? {},
    );
    lead.updateRequirements(requirements, now);

    if (command.visitRequested === true) lead.markVisitRequested(now);
    if (command.consent) lead.grantConsent({ ...command.consent }, now);

    await this.deps.qualifier.qualify(lead, {
      hasName: hasName(context.profile),
      contactMessages: context.messages.filter((message) => message.role === "contact").length,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.leads.save(lead);
      if (created) {
        await this.deps.events.publish(LeadCaptured, {
          leadId: lead.id,
          contactId: lead.contactId,
          conversationId: lead.conversationId,
          source: context.channelType,
        });
      }
    });

    return ok(toView(lead, created));
  }

  private newLead(command: CaptureLeadCommand, context: ConversationContext): Lead {
    return Lead.capture({
      id: this.deps.ids.generate(),
      tenantId: TenantContext.requireTenantId(),
      contactId: command.contactId,
      conversationId: command.conversationId,
      // El canal se toma de la conversación, no del comando: quien llama no
      // tiene por qué saber por dónde entró el cliente, ni podría mentir.
      source: context.channelType,
      now: this.deps.clock.now(),
    });
  }
}

export const toView = (lead: Lead, created: boolean): LeadView => ({
  id: lead.id,
  status: lead.status,
  score: lead.score.value,
  band: lead.score.band,
  ...(lead.assignedUserId !== undefined ? { assignedUserId: lead.assignedUserId } : {}),
  interestCount: lead.interests.length,
  created,
});
