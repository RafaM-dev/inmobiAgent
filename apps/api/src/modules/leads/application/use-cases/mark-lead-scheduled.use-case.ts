import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { okVoid, type Result } from "../../../../platform/result/result";
import { LeadStatus } from "../../domain/entities/lead";
import type { LeadRepository } from "../../domain/repositories/lead.repository";
import { LeadStatusChanged } from "../events/leads.events";

/**
 * Mueve el lead a `SCHEDULED` cuando se agenda una visita.
 *
 * Lo llama `appointments` a través del puerto público, nunca escribiendo en las
 * tablas de leads: la dirección de la dependencia es appointments → leads, y en
 * un solo sentido. Así `leads` sigue siendo dueño de su embudo.
 *
 * Es tolerante a que no exista lead: la cita ya está creada y correcta, y
 * devolver un error aquí haría que el cliente viera "no pude agendar" tras una
 * cita que sí quedó agendada. Se registra y se sigue.
 */
export class MarkLeadScheduledUseCase {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(conversationId: string): Promise<Result<void, AppError>> {
    const lead = await this.deps.leads.findByConversation(conversationId);

    if (!lead) {
      this.deps.logger.warn("Se agendó una visita sin lead asociado", { conversationId });
      return okVoid();
    }

    if (lead.status === LeadStatus.SCHEDULED || !lead.isOpen) return okVoid();

    const from = lead.status;
    lead.changeStatus(LeadStatus.SCHEDULED, this.deps.clock.now(), "appointment_requested");

    await this.deps.unitOfWork.run(async () => {
      await this.deps.leads.save(lead);
      await this.deps.events.publish(LeadStatusChanged, {
        leadId: lead.id,
        conversationId,
        from,
        to: LeadStatus.SCHEDULED,
        reason: "appointment_requested",
      });
    });

    return okVoid();
  }
}
