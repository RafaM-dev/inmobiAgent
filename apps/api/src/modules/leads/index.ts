import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { EventSubscription } from "../../platform/events/event";
import type { ConversationCradle } from "../conversation";
import { requireSession, type IdentityCradle } from "../identity";
import { registerLeadsRoutes } from "./interface/http/leads.routes";
import { onPropertyShown } from "./application/event-handlers/on-property-shown";
import type { LeadService } from "./application/ports/lead-service";
import { LeadQualifier } from "./application/services/lead-qualifier";
import { LeadServiceFacade } from "./application/services/lead-service.facade";
import { CaptureLeadUseCase } from "./application/use-cases/capture-lead.use-case";
import { ListLeadsUseCase } from "./application/use-cases/list-leads.use-case";
import {
  AssignLeadUseCase,
  ChangeLeadStatusUseCase,
} from "./application/use-cases/manage-lead.use-cases";
import { MarkLeadScheduledUseCase } from "./application/use-cases/mark-lead-scheduled.use-case";
import { RegisterLeadInterestUseCase } from "./application/use-cases/register-lead-interest.use-case";
import type { LeadRepository } from "./domain/repositories/lead.repository";
import { PrismaLeadRepository } from "./infrastructure/persistence/prisma/prisma-lead.repository";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `leads`
 *
 * La ficha comercial de un cliente potencial. Vive fuera de `conversation`
 * porque una conversación se cierra y un lead se sigue trabajando durante
 * meses: son dos ciclos de vida distintos, y mezclarlos obligaría a mantener
 * viva una conversación solo para no perder el lead.
 * ========================================================================== */

export type {
  LeadService,
  LeadView,
  CaptureLeadCommand,
} from "./application/ports/lead-service";
export { LeadStatus } from "./domain/entities/lead";
export { LeadBand } from "./domain/value-objects/lead-score";
export type { LeadScore, ScoreReason } from "./domain/value-objects/lead-score";
export {
  LeadOperation,
  LeadPropertyType,
  LeadTimeline,
  LeadFinancing,
  describeRequirements,
  type LeadRequirements,
  type LeadBudget,
} from "./domain/value-objects/lead-requirements";
export type { LeadSummary, LeadListFilter } from "./domain/repositories/lead.repository";
export {
  LeadCaptured,
  LeadQualified,
  LeadAssigned,
  LeadStatusChanged,
  type LeadCapturedPayload,
  type LeadQualifiedPayload,
  type LeadAssignedPayload,
  type LeadStatusChangedPayload,
} from "./application/events/leads.events";

export interface LeadsCradle {
  leadRepository: LeadRepository;
  leadQualifier: LeadQualifier;
  captureLead: CaptureLeadUseCase;
  registerLeadInterest: RegisterLeadInterestUseCase;
  markLeadScheduled: MarkLeadScheduledUseCase;
  listLeads: ListLeadsUseCase;
  changeLeadStatus: ChangeLeadStatusUseCase;
  assignLead: AssignLeadUseCase;
  /** Puerto público: es lo que consumen el agente y `appointments`. */
  leadService: LeadService;
}

type Cradle = PlatformCradle & IdentityCradle & ConversationCradle & LeadsCradle;

export const leadsModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "leads",

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      leadRepository: asFunction(
        (c: Cradle): LeadRepository => new PrismaLeadRepository(c.database, c.ids),
      ).singleton(),

      leadQualifier: asFunction(
        (c: Cradle) =>
          new LeadQualifier({
            leads: c.leadRepository,
            advisors: c.advisorDirectory,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      captureLead: asFunction(
        (c: Cradle) =>
          new CaptureLeadUseCase({
            leads: c.leadRepository,
            conversations: c.conversationService,
            qualifier: c.leadQualifier,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
          }),
      ).singleton(),

      registerLeadInterest: asFunction(
        (c: Cradle) =>
          new RegisterLeadInterestUseCase({
            leads: c.leadRepository,
            capture: c.captureLead,
            conversations: c.conversationService,
            qualifier: c.leadQualifier,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
          }),
      ).singleton(),

      markLeadScheduled: asFunction(
        (c: Cradle) =>
          new MarkLeadScheduledUseCase({
            leads: c.leadRepository,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "leads" }),
          }),
      ).singleton(),

      listLeads: asFunction((c: Cradle) => new ListLeadsUseCase({ leads: c.leadRepository })),

      changeLeadStatus: asFunction(
        (c: Cradle) =>
          new ChangeLeadStatusUseCase({
            leads: c.leadRepository,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      assignLead: asFunction(
        (c: Cradle) =>
          new AssignLeadUseCase({
            leads: c.leadRepository,
            advisors: c.advisorDirectory,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      leadService: asFunction(
        (c: Cradle): LeadService =>
          new LeadServiceFacade({
            capture: c.captureLead,
            markScheduled: c.markLeadScheduled,
            leads: c.leadRepository,
          }),
      ).singleton(),
    });
  },

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerLeadsRoutes(app, {
      listLeads: cradle.listLeads,
      changeLeadStatus: cradle.changeLeadStatus,
      assignLead: cradle.assignLead,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
    });
  },

  /**
   * La captura determinista: si el catálogo mostró algo, hay ficha. No depende
   * de que el modelo se acuerde de llamar a ninguna herramienta.
   */
  registerSubscriptions(cradle: Cradle): EventSubscription[] {
    return [
      onPropertyShown({
        registerInterest: cradle.registerLeadInterest,
        logger: cradle.logger.child({ module: "leads" }),
      }),
    ];
  },
};
