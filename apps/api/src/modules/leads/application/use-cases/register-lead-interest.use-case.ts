import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, isErr, ok, type Result } from "../../../../platform/result/result";
import type { ConversationService } from "../../../conversation";
import type { LeadRepository } from "../../domain/repositories/lead.repository";
import { hasName } from "../mappers/profile-to-requirements.mapper";
import type { LeadView } from "../ports/lead-service";
import type { LeadQualifier } from "../services/lead-qualifier";
import { toView } from "./capture-lead.use-case";
import type { CaptureLeadUseCase } from "./capture-lead.use-case";

export interface RegisterLeadInterestCommand {
  readonly conversationId: string;
  readonly contactId: string;
  /** Referencias mostradas, en formato `"source:externalId"`. */
  readonly propertyRefs: readonly string[];
  readonly shownAt: Date;
}

/**
 * Un cliente al que se le enseñaron inmuebles ES un lead.
 *
 * Esta es la captura que NO depende de que el modelo se acuerde de llamar a
 * `register_lead`. El agente puede olvidarse, cambiar de proveedor de IA o
 * responder raro un martes; si el catálogo mostró algo, la ficha existe y el
 * interés queda registrado. Lo determinista sostiene al producto; el modelo
 * solo lo hace conversacional.
 *
 * Reacciona a `catalog.property_shown`, un evento que F3 ya publicaba sin
 * consumidores precisamente para que F4 no tuviera que tocar `catalog`.
 */
export class RegisterLeadInterestUseCase {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      capture: CaptureLeadUseCase;
      conversations: ConversationService;
      qualifier: LeadQualifier;
      unitOfWork: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(
    command: RegisterLeadInterestCommand,
  ): Promise<Result<LeadView, AppError>> {
    // Asegura la ficha antes de anotar nada. Es idempotente: si ya existía, esto
    // solo refresca requisitos y puntuación.
    const captured = await this.deps.capture.execute({
      conversationId: command.conversationId,
      contactId: command.contactId,
    });
    if (isErr(captured)) return captured;

    const lead = await this.deps.leads.findByConversation(command.conversationId);
    if (!lead) return err(new NotFoundError("Lead de la conversación", command.conversationId));

    for (const ref of command.propertyRefs) {
      lead.registerInterest(ref, command.shownAt);
    }

    const contextResult = await this.deps.conversations.getContext(command.conversationId);
    const context = isErr(contextResult) ? undefined : contextResult.value;

    await this.deps.qualifier.qualify(lead, {
      hasName: context ? hasName(context.profile) : false,
      contactMessages:
        context?.messages.filter((message) => message.role === "contact").length ?? 0,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.leads.save(lead);
    });

    return ok(toView(lead, captured.value.created));
  }
}
