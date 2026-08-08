import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { EventSubscription } from "../../platform/events/event";
import { isErr } from "../../platform/result/result";
import type { AppointmentsCradle } from "../appointments";
import { defaultCapabilities, type ChannelsCradle } from "../channels";
import type { CatalogCradle } from "../catalog";
import type { ConversationCradle } from "../conversation";
import { requireSession, type IdentityCradle } from "../identity";
import type { KnowledgeCradle } from "../knowledge";
import type { LeadsCradle } from "../leads";
import { onTurnReady } from "./application/event-handlers/on-turn-ready";
import { CitationGuardrail } from "./application/guardrails/citation.guardrail";
import {
  GroundingGuardrail,
  LengthGuardrail,
  NoPromisesGuardrail,
} from "./application/guardrails/grounding.guardrail";
import type { Guardrail } from "./application/guardrails/guardrail";
import {
  HeuristicTokenCounter,
  type LLMProvider,
  type TokenCounter,
} from "./application/ports/llm-provider";
import type { SlotExtractor } from "./application/ports/slot-extractor";
import type { UsageLedger } from "./application/ports/usage-ledger";
import { PromptRegistry } from "./application/prompts/prompt-registry";
import { systemPromptV1 } from "./application/prompts/system-prompt.v1";
import { ContextBuilder } from "./application/runtime/context-builder";
import { ToolRegistry } from "./application/runtime/tool-registry";
import { HandoffCoordinator } from "./application/services/handoff-coordinator";
import {
  createCheckAvailabilityTool,
  createPropertyDetailsTool,
  createPropertyMediaTool,
} from "./application/tools/property-details.tool";
import { createRegisterLeadTool } from "./application/tools/register-lead.tool";
import { createSearchKnowledgeTool } from "./application/tools/search-knowledge.tool";
import { createRequestHumanTool } from "./application/tools/request-human-agent.tool";
import { createSearchPropertiesTool } from "./application/tools/search-properties.tool";
import { createSavePreferencesTool } from "./application/tools/save-customer-preferences.tool";
import {
  createProposeVisitSlotsTool,
  createScheduleVisitTool,
} from "./application/tools/visit-scheduling.tools";
import { GetUsageSummaryUseCase } from "./application/use-cases/get-usage-summary.use-case";
import { RunAgentTurnUseCase } from "./application/use-cases/run-agent-turn.use-case";
import { registerUsageRoutes } from "./interface/http/usage.routes";
import type { AgentRunRepository } from "./domain/repositories/agent-run.repository";
import { RuleBasedSlotExtractor } from "./infrastructure/extraction/rule-based-slot-extractor";
import { AnthropicLLMProvider } from "./infrastructure/llm/anthropic/anthropic-llm-provider";
import { MockLLMProvider } from "./infrastructure/llm/mock/mock-llm-provider";
import { OpenAiCompatibleLLMProvider } from "./infrastructure/llm/openai/openai-llm-provider";
import { PrismaAgentRunRepository } from "./infrastructure/persistence/prisma/prisma-agent-run.repository";
import { PrismaUsageLedger } from "./infrastructure/persistence/prisma/prisma-usage-ledger";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `agent`
 * ========================================================================== */

export type { LLMProvider, LlmMessage, LlmToolSchema } from "./application/ports/llm-provider";
export type { AgentTool, ToolContext, ToolResult } from "./application/ports/agent-tool";
export { toolOk, toolError } from "./application/ports/agent-tool";
export {
  AgentRunCompleted,
  AgentRunFailed,
  HandoffRequested,
  type AgentRunCompletedPayload,
  type HandoffRequestedPayload,
} from "./application/events/agent.events";
export { HandoffReason } from "./domain/policies/escalation.policy";
export { Intent, classifyIntent } from "./domain/value-objects/intent";

export interface AgentCradle {
  llmProvider: LLMProvider;
  tokenCounter: TokenCounter;
  slotExtractor: SlotExtractor;
  promptRegistry: PromptRegistry;
  agentContextBuilder: ContextBuilder;
  agentToolRegistry: ToolRegistry;
  agentGuardrails: readonly Guardrail[];
  handoffCoordinator: HandoffCoordinator;
  agentRunRepository: AgentRunRepository;
  usageLedger: UsageLedger;
  getUsageSummary: GetUsageSummaryUseCase;
  runAgentTurn: RunAgentTurnUseCase;
}

type Cradle = PlatformCradle &
  IdentityCradle &
  ChannelsCradle &
  ConversationCradle &
  CatalogCradle &
  LeadsCradle &
  AppointmentsCradle &
  KnowledgeCradle &
  AgentCradle;

export const agentModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "agent",

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    registerUsageRoutes(app, {
      getUsage: cradle.getUsageSummary,
      requireSession: requireSession({
        sessions: cradle.sessionService,
        isProduction: cradle.config.isProduction,
      }),
    });
  },

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      /**
       * ÚNICO punto del sistema donde se elige el proveedor de IA.
       *
       * `LLM_PROVIDER=openai` en el entorno y aquí se construye otro adaptador;
       * ni un caso de uso, ni una política, ni una herramienta cambian. Los
       * proveedores reales encajan en este `switch`: uno más es un `case` más.
       */
      llmProvider: asFunction((c: Cradle): LLMProvider => {
        const { credentials, models, llmRuntime } = c.config.providers;
        const logger = c.logger.child({ module: "agent", component: "llm" });

        /**
         * Falta una credencial: se falla AL ARRANCAR, no en el primer turno.
         *
         * Un proceso que levanta con `LLM_PROVIDER=anthropic` y sin clave
         * descubriría el problema con un cliente esperando respuesta por
         * WhatsApp. Aquí lo descubre quien despliega, en el segundo cero.
         */
        const requireCredential = (value: string | undefined, variable: string): string => {
          if (!value) {
            throw new Error(
              `LLM_PROVIDER=${c.config.providers.llm} necesita ${variable}. ` +
                "Con LLM_PROVIDER=mock el producto funciona entero sin ninguna clave.",
            );
          }
          return value;
        };

        switch (c.config.providers.llm) {
          case "mock":
            return new MockLLMProvider({ tokens: c.tokenCounter });

          case "anthropic":
            return new AnthropicLLMProvider({
              options: {
                apiKey: requireCredential(credentials.anthropicApiKey, "ANTHROPIC_API_KEY"),
                ...(models.anthropic ? { model: models.anthropic } : {}),
                effort: llmRuntime.effort,
                timeoutMs: llmRuntime.timeoutMs,
                maxRetries: llmRuntime.maxRetries,
              },
              logger,
            });

          case "openai":
            return new OpenAiCompatibleLLMProvider({
              options: {
                id: "openai",
                apiKey: requireCredential(credentials.openaiApiKey, "OPENAI_API_KEY"),
                /*
                 * Sin modelo por defecto, a diferencia de Anthropic. El
                 * catálogo de OpenAI cambia deprisa y elegir uno por ti sería
                 * decidir tu factura: se pide explícito.
                 */
                model: requireCredential(models.openai, "OPENAI_MODEL"),
                timeoutMs: llmRuntime.timeoutMs,
                maxRetries: llmRuntime.maxRetries,
              },
              logger,
            });

          case "ollama":
            return new OpenAiCompatibleLLMProvider({
              options: {
                id: "ollama",
                /*
                 * Ollama expone un endpoint compatible con OpenAI y no pide
                 * autenticación, pero el SDK exige una clave no vacía. Este
                 * valor no viaja a ninguna parte que lo mire.
                 */
                apiKey: "ollama-no-necesita-clave",
                model: models.ollama,
                baseUrl: `${credentials.ollamaBaseUrl.replace(/\/+$/, "")}/v1`,
                // Un modelo local en CPU tarda bastante más que una API.
                timeoutMs: Math.max(llmRuntime.timeoutMs, 120_000),
                maxRetries: llmRuntime.maxRetries,
              },
              logger,
            });

          default:
            throw new Error(
              `El proveedor "${c.config.providers.llm}" todavía no tiene adaptador. ` +
                "Usa LLM_PROVIDER=mock para el modo demo.",
            );
        }
      }).singleton(),

      tokenCounter: asFunction((): TokenCounter => new HeuristicTokenCounter()).singleton(),

      slotExtractor: asFunction((): SlotExtractor => new RuleBasedSlotExtractor()).singleton(),

      promptRegistry: asFunction(() => {
        const registry = new PromptRegistry();
        registry.register(systemPromptV1);
        return registry;
      }).singleton(),

      agentContextBuilder: asFunction(
        (c: Cradle) => new ContextBuilder({ prompts: c.promptRegistry, tokens: c.tokenCounter }),
      ).singleton(),

      agentGuardrails: asFunction((): readonly Guardrail[] => [
        // El orden importa: primero lo que no se puede enviar de ninguna forma,
        // y al final los ajustes cosméticos. `citation` va antes que
        // `grounding` porque puede sustituir el texto entero, y no tiene
        // sentido validar cifras de un texto que se va a descartar.
        new NoPromisesGuardrail(),
        new CitationGuardrail(),
        new GroundingGuardrail(),
        new LengthGuardrail(),
      ]).singleton(),

      handoffCoordinator: asFunction(
        (c: Cradle) =>
          new HandoffCoordinator({
            conversations: c.conversationService,
            events: c.eventPublisher,
            logger: c.logger.child({ module: "agent" }),
          }),
      ).singleton(),

      /**
       * Catálogo de herramientas: todo lo que el agente sabe hacer con el
       * mundo. Cada una envuelve el PUERTO de otro módulo, nunca su
       * implementación — por eso esta lista se lee como el alcance funcional
       * del producto y no como un mapa de dependencias.
       */
      agentToolRegistry: asFunction((c: Cradle) => {
        const registry = new ToolRegistry({
          logger: c.logger.child({ module: "agent", component: "tools" }),
          clock: c.clock,
        });

        registry.register(createSavePreferencesTool({ conversations: c.conversationService }));
        registry.register(createRequestHumanTool({ handoff: c.handoffCoordinator }));
        registry.register(
          createSearchPropertiesTool({
            catalog: c.catalogService,
            conversations: c.conversationService,
          }),
        );
        registry.register(createPropertyDetailsTool({ catalog: c.catalogService }));
        registry.register(createCheckAvailabilityTool({ catalog: c.catalogService }));
        registry.register(createPropertyMediaTool({ catalog: c.catalogService }));
        registry.register(createSearchKnowledgeTool({ knowledge: c.knowledgeService }));
        registry.register(createRegisterLeadTool({ leads: c.leadService }));
        registry.register(
          createProposeVisitSlotsTool({ appointments: c.appointmentService, clock: c.clock }),
        );
        registry.register(createScheduleVisitTool({ appointments: c.appointmentService }));

        return registry;
      }).singleton(),

      agentRunRepository: asFunction(
        (c: Cradle): AgentRunRepository => new PrismaAgentRunRepository(c.database, c.ids),
      ).singleton(),

      usageLedger: asFunction(
        (c: Cradle): UsageLedger => new PrismaUsageLedger(c.database),
      ).singleton(),

      getUsageSummary: asFunction(
        (c: Cradle) =>
          new GetUsageSummaryUseCase({
            usage: c.usageLedger,
            tenants: c.tenantDirectory,
            clock: c.clock,
            defaultMonthlyBudgetUsd: c.config.agent.monthlyBudgetUsd,
          }),
      ).singleton(),

      runAgentTurn: asFunction(
        (c: Cradle) =>
          new RunAgentTurnUseCase({
            conversations: c.conversationService,
            tenants: c.tenantDirectory,
            llm: c.llmProvider,
            tools: c.agentToolRegistry,
            contextBuilder: c.agentContextBuilder,
            slotExtractor: c.slotExtractor,
            guardrails: c.agentGuardrails,
            handoff: c.handoffCoordinator,
            runs: c.agentRunRepository,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
            logger: c.logger.child({ module: "agent" }),
            limits: {
              maxIterations: c.config.agent.maxToolIterations,
              maxToolCalls: c.config.agent.maxToolCalls,
              timeoutMs: c.config.agent.turnTimeoutMs,
            },
            usage: c.usageLedger,
            defaultMonthlyBudgetUsd: c.config.agent.monthlyBudgetUsd,
            rateLimiter: c.rateLimiter,
            turnQuota: c.config.rateLimit.contactTurns,
            capabilitiesOf: async (channelAccountId: string) => {
              const found = await c.getChannelCapabilities.execute(channelAccountId);
              // Si la cuenta desapareció, se asume el canal más pobre posible:
              // degradar de más es seguro, quedarse corto no.
              return isErr(found) ? defaultCapabilities({ maxTextLength: 1000 }) : found.value;
            },
          }),
      ).singleton(),
    });
  },

  registerSubscriptions(cradle: Cradle): EventSubscription[] {
    return [
      onTurnReady({
        runTurn: cradle.runAgentTurn,
        logger: cradle.logger.child({ module: "agent" }),
      }),
    ];
  },
};
