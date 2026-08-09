import type { Clock } from "../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../platform/database/unit-of-work";
import type { EventSubscription } from "../../../platform/events/event";
import type { EventPublisher } from "../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../platform/ids/id-generator";
import type { Logger } from "../../../platform/logging/logger";
import type { ConversationService } from "../../conversation";
import type { AdvisorDirectory, AdvisorView } from "../../identity";
import { onPropertyShown } from "../application/event-handlers/on-property-shown";
import type { LeadService } from "../application/ports/lead-service";
import { LeadQualifier } from "../application/services/lead-qualifier";
import { LeadServiceFacade } from "../application/services/lead-service.facade";
import { CaptureLeadUseCase } from "../application/use-cases/capture-lead.use-case";
import { MarkLeadScheduledUseCase } from "../application/use-cases/mark-lead-scheduled.use-case";
import { RegisterLeadInterestUseCase } from "../application/use-cases/register-lead-interest.use-case";
import type { LeadRepository } from "../domain/repositories/lead.repository";
import { InMemoryLeadRepository } from "./in-memory-lead.repository";

/**
 * `leads` completo en memoria, con los casos de uso REALES.
 *
 * Existe para que otro módulo pueda probarse contra un CRM que se comporta como
 * el de verdad —captura idempotente, scoring, asignación— sin base de datos y
 * sin importar nada de dentro de este módulo. Es el mismo patrón que
 * `createInMemoryCatalog` en F3.
 */

export class StaticAdvisorDirectory implements AdvisorDirectory {
  constructor(private readonly advisors: readonly AdvisorView[] = []) {}

  listAssignable(): Promise<readonly AdvisorView[]> {
    return Promise.resolve(this.advisors);
  }

  findById(userId: string): Promise<AdvisorView | null> {
    return Promise.resolve(this.advisors.find((advisor) => advisor.id === userId) ?? null);
  }
}

export interface InMemoryLeads {
  readonly service: LeadService;
  readonly repository: LeadRepository & InMemoryLeadRepository;
  readonly registerInterest: RegisterLeadInterestUseCase;
  /**
   * Las MISMAS suscripciones que registra el módulo al arrancar.
   *
   * Se exponen para que un arné pueda conectar la cadena completa —el catálogo
   * muestra inmuebles, el CRM se llena solo— en vez de dar por hecho que
   * funciona. Es la promesa del producto que menos se puede probar por partes:
   * lo interesante es justamente que nadie llama al CRM a mano.
   */
  readonly subscriptions: readonly EventSubscription[];
}

export const createInMemoryLeads = (deps: {
  conversations: ConversationService;
  events: EventPublisher;
  clock: Clock;
  logger: Logger;
  advisors?: AdvisorDirectory;
}): InMemoryLeads => {
  const repository = new InMemoryLeadRepository();
  const unitOfWork = new NoopUnitOfWork();

  const qualifier = new LeadQualifier({
    leads: repository,
    advisors: deps.advisors ?? new StaticAdvisorDirectory(),
    events: deps.events,
    clock: deps.clock,
  });

  const capture = new CaptureLeadUseCase({
    leads: repository,
    conversations: deps.conversations,
    qualifier,
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
    ids: new SequentialIdGenerator("lead"),
  });

  const markScheduled = new MarkLeadScheduledUseCase({
    leads: repository,
    unitOfWork,
    events: deps.events,
    clock: deps.clock,
    logger: deps.logger,
  });

  const registerInterest = new RegisterLeadInterestUseCase({
    leads: repository,
    capture,
    conversations: deps.conversations,
    qualifier,
    unitOfWork,
    clock: deps.clock,
  });

  return {
    repository,
    registerInterest,
    service: new LeadServiceFacade({ capture, markScheduled, leads: repository }),
    subscriptions: [onPropertyShown({ registerInterest, logger: deps.logger })],
  };
};
