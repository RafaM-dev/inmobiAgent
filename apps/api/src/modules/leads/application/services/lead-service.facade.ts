import type { AppError } from "../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../platform/result/result";
import type { LeadRepository } from "../../domain/repositories/lead.repository";
import type { CaptureLeadCommand, LeadService, LeadView } from "../ports/lead-service";
import { toView, type CaptureLeadUseCase } from "../use-cases/capture-lead.use-case";
import type { MarkLeadScheduledUseCase } from "../use-cases/mark-lead-scheduled.use-case";

/**
 * Implementación del puerto público. Delega en los casos de uso y no añade
 * lógica: si algún día aparece una regla aquí, está en el sitio equivocado.
 */
export class LeadServiceFacade implements LeadService {
  constructor(
    private readonly deps: {
      capture: CaptureLeadUseCase;
      markScheduled: MarkLeadScheduledUseCase;
      leads: LeadRepository;
    },
  ) {}

  capture(command: CaptureLeadCommand): Promise<Result<LeadView, AppError>> {
    return this.deps.capture.execute(command);
  }

  async findByConversation(conversationId: string): Promise<Result<LeadView | null, AppError>> {
    const lead = await this.deps.leads.findByConversation(conversationId);
    return ok(lead ? toView(lead, false) : null);
  }

  markScheduled(conversationId: string): Promise<Result<void, AppError>> {
    return this.deps.markScheduled.execute(conversationId);
  }
}
