import { FixedClock } from "../../../platform/clock/clock";
import type { AppError } from "../../../platform/errors/app-error";
import { RecordingEventPublisher } from "../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../platform/ids/id-generator";
import { NoopLogger } from "../../../platform/logging/logger";
import { ok, okVoid, type Result } from "../../../platform/result/result";
import { blocksToText, defaultCapabilities, type ReplyBlock } from "../../channels";
import { createInMemoryCatalog, type InMemoryCatalog } from "../../catalog/testing/in-memory-catalog";
import type {
  ContextMessage,
  ConversationContext,
  ConversationService,
  ProfileChange,
  ProfileSlot,
  ProfileSlots,
} from "../../conversation";
import type { TenantDirectory, TenantView } from "../../identity";
import {
  createInMemoryAppointments,
  type InMemoryAppointments,
} from "../../appointments/testing/in-memory-appointments";
import { createInMemoryLeads, type InMemoryLeads } from "../../leads/testing/in-memory-leads";
import {
  createInMemoryKnowledge,
  type InMemoryKnowledge,
} from "../../knowledge/testing/in-memory-knowledge";
import { ContextBuilder } from "../application/runtime/context-builder";
import { ToolRegistry } from "../application/runtime/tool-registry";
import { HandoffCoordinator } from "../application/services/handoff-coordinator";
import { PromptRegistry } from "../application/prompts/prompt-registry";
import { systemPromptV1 } from "../application/prompts/system-prompt.v1";
import { CitationGuardrail } from "../application/guardrails/citation.guardrail";
import {
  GroundingGuardrail,
  LengthGuardrail,
  NoPromisesGuardrail,
} from "../application/guardrails/grounding.guardrail";
import { HeuristicTokenCounter, type LLMProvider } from "../application/ports/llm-provider";
import {
  createCheckAvailabilityTool,
  createPropertyDetailsTool,
  createPropertyMediaTool,
} from "../application/tools/property-details.tool";
import { createRegisterLeadTool } from "../application/tools/register-lead.tool";
import { createSearchKnowledgeTool } from "../application/tools/search-knowledge.tool";
import { createRequestHumanTool } from "../application/tools/request-human-agent.tool";
import {
  createProposeVisitSlotsTool,
  createScheduleVisitTool,
} from "../application/tools/visit-scheduling.tools";
import { createSearchPropertiesTool } from "../application/tools/search-properties.tool";
import { createSavePreferencesTool } from "../application/tools/save-customer-preferences.tool";
import { RunAgentTurnUseCase } from "../application/use-cases/run-agent-turn.use-case";
import type { AgentRun } from "../domain/entities/agent-run";
import type { AgentRunRepository } from "../domain/repositories/agent-run.repository";
import { RuleBasedSlotExtractor } from "../infrastructure/extraction/rule-based-slot-extractor";
import { MockLLMProvider } from "../infrastructure/llm/mock/mock-llm-provider";

/**
 * Banco de pruebas del turno completo, sin base de datos y sin red.
 *
 * Monta el orquestador real con dobles en memoria de los tres puertos que
 * cruzan frontera de módulo: conversaciones, tenants y persistencia del run.
 * Todo lo demás —políticas, presupuesto, herramientas, guardrails, proveedor
 * simulado— es el código de producción tal cual.
 */

export const TENANT: TenantView = {
  id: "t1",
  slug: "inmobiliaria-demo",
  name: "Inmobiliaria Demo",
  status: "ACTIVE",
  plan: "PRO",
  locale: "es-CO",
  timezone: "America/Bogota",
  currency: "COP",
  settings: {
    agentDisplayName: "Sofía",
    tone: "CERCANO",
    maxConsecutiveFailedTurns: 2,
  },
};

/** Conversación en memoria: guarda el perfil, las respuestas y el control. */
export class FakeConversationService implements ConversationService {
  profile: ProfileSlots = {};
  readonly replies: { blocks: readonly ReplyBlock[]; authorType: string }[] = [];
  /**
   * Historial real de la conversación. Sin esto no se pueden probar flujos de
   * dos turnos —"¿cuál horario prefieres?" / "la segunda"—, que es justo donde
   * un agente conversacional se rompe.
   */
  readonly history: ContextMessage[] = [];
  paused: { reason: string } | undefined;
  status: ConversationContext["status"] = "OPEN";

  constructor(private readonly missing: readonly string[] = []) {}

  /** Anota lo que escribió el cliente, como haría la ingesta real. */
  recordContact(text: string, at = new Date()): void {
    this.history.push({ role: "contact", text, sentAt: at });
  }

  getContext(conversationId: string): Promise<Result<ConversationContext, AppError>> {
    return Promise.resolve(
      ok({
        conversationId,
        contactId: "ct1",
        contactName: "Cliente",
        channelType: "CONSOLE" as const,
        channelAccountId: "acc1",
        externalContactId: "+573001112233",
        status: this.status,
        stage: "DISCOVERY" as const,
        messages: this.history,
        profile: this.profile,
        missingRequiredSlots: this.missing as never,
      }),
    );
  }

  reply(command: {
    blocks: readonly ReplyBlock[];
    authorType?: string;
  }): Promise<Result<{ messageId: string; delivered: boolean }, AppError>> {
    this.replies.push({ blocks: command.blocks, authorType: command.authorType ?? "AGENT" });
    // La misma proyección a texto que usa el mensaje persistido: lo que el
    // agente lea en el turno siguiente es lo que el cliente vio.
    this.history.push({
      role: command.authorType === "CONTACT" ? "contact" : "assistant",
      text: blocksToText(command.blocks),
      sentAt: new Date(),
    });
    return Promise.resolve(ok({ messageId: `m${String(this.replies.length)}`, delivered: true }));
  }

  remember(command: {
    slots: ProfileSlots;
  }): Promise<Result<readonly ProfileChange[], AppError>> {
    const changes: ProfileChange[] = [];
    const proposed = command.slots as Record<string, ProfileSlot<unknown> | undefined>;
    for (const [name, incoming] of Object.entries(proposed)) {
      if (!incoming) continue;
      const current = (this.profile as Record<string, { source: string } | undefined>)[name];
      // Réplica de la regla real: lo explícito gana a lo deducido.
      if (current && current.source !== "inferred" && incoming.source === "inferred") continue;

      (this.profile as Record<string, unknown>)[name] = incoming;
      changes.push({
        slot: name as ProfileChange["slot"],
        value: incoming.value,
        source: incoming.source,
        confidence: incoming.confidence,
        updatedAt: incoming.updatedAt,
      });
    }
    return Promise.resolve(ok(changes));
  }

  pauseBot(_conversationId: string, reason: string): Promise<Result<void, AppError>> {
    this.paused = { reason };
    this.status = "BOT_PAUSED";
    return Promise.resolve(okVoid());
  }
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  readonly runs: AgentRun[] = [];

  save(run: AgentRun): Promise<void> {
    this.runs.push(run);
    return Promise.resolve();
  }
  findById(): Promise<AgentRun | null> {
    return Promise.resolve(null);
  }
  listByConversation(): Promise<AgentRun[]> {
    return Promise.resolve(this.runs);
  }
}

const tenantDirectory = (tenant: TenantView): TenantDirectory => ({
  findById: () => Promise.resolve(tenant),
  findBySlug: () => Promise.resolve(tenant),
  requireActive: () => Promise.resolve(tenant),
});

export interface Harness {
  readonly runTurn: RunAgentTurnUseCase;
  readonly conversations: FakeConversationService;
  readonly runs: InMemoryAgentRunRepository;
  readonly events: RecordingEventPublisher;
  readonly catalog: InMemoryCatalog;
  readonly leads: InMemoryLeads;
  readonly appointments: InMemoryAppointments;
  readonly knowledge: InMemoryKnowledge;
}

export const createHarness = (options: {
  llm?: LLMProvider;
  missing?: readonly string[];
  tenant?: TenantView;
  limits?: { maxIterations: number; maxToolCalls: number; timeoutMs: number };
} = {}): Harness => {
  const tokens = new HeuristicTokenCounter();
  const conversations = new FakeConversationService(options.missing ?? []);
  const runs = new InMemoryAgentRunRepository();
  const events = new RecordingEventPublisher();
  const logger = new NoopLogger();
  const clock = new FixedClock(new Date("2026-07-01T15:00:00.000Z"));

  const prompts = new PromptRegistry();
  prompts.register(systemPromptV1);

  const handoff = new HandoffCoordinator({ conversations, events, logger });

  const catalog = createInMemoryCatalog({ events, clock, logger });

  const tenants = tenantDirectory(options.tenant ?? TENANT);
  const leads = createInMemoryLeads({ conversations, events, clock, logger });
  const appointments = createInMemoryAppointments({
    tenants,
    leads: leads.service,
    events,
    clock,
    logger,
  });

  const knowledge = createInMemoryKnowledge({ events, clock, logger });

  const tools = new ToolRegistry({ logger, clock });
  tools.register(createSavePreferencesTool({ conversations }));
  tools.register(createRequestHumanTool({ handoff }));
  tools.register(createSearchPropertiesTool({ catalog: catalog.service, conversations }));
  tools.register(createPropertyDetailsTool({ catalog: catalog.service }));
  tools.register(createCheckAvailabilityTool({ catalog: catalog.service }));
  tools.register(createPropertyMediaTool({ catalog: catalog.service }));
  tools.register(createSearchKnowledgeTool({ knowledge: knowledge.service }));
  tools.register(createRegisterLeadTool({ leads: leads.service }));
  tools.register(createProposeVisitSlotsTool({ appointments: appointments.service, clock }));
  tools.register(createScheduleVisitTool({ appointments: appointments.service }));

  const runTurn = new RunAgentTurnUseCase({
    conversations,
    tenants,
    llm: options.llm ?? new MockLLMProvider({ tokens }),
    tools,
    contextBuilder: new ContextBuilder({ prompts, tokens }),
    slotExtractor: new RuleBasedSlotExtractor(),
    guardrails: [
      new NoPromisesGuardrail(),
      new CitationGuardrail(),
      new GroundingGuardrail(),
      new LengthGuardrail(),
    ],
    handoff,
    runs,
    events,
    clock,
    ids: new SequentialIdGenerator("run"),
    logger,
    limits: options.limits ?? { maxIterations: 6, maxToolCalls: 10, timeoutMs: 45_000 },
    capabilitiesOf: () => Promise.resolve(defaultCapabilities({ maxTextLength: 1200 })),
  });

  return { runTurn, conversations, runs, events, catalog, leads, appointments, knowledge };
};
