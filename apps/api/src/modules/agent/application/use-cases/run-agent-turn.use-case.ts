import type { Clock } from "../../../../platform/clock/clock";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import type { RateLimiter } from "../../../../platform/rate-limit/rate-limiter";
import type { Quota } from "../../../../platform/rate-limit/token-bucket";
import { isErr, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import {
  quickRepliesBlock,
  textBlock,
  type ChannelCapabilities,
  type ReplyBlock,
} from "../../../channels";
import {
  MessageAuthorType,
  slot,
  SlotSource,
  type ConversationContext,
  type ConversationService,
  type ProfileSlots,
} from "../../../conversation";
import type { TenantDirectory, TenantView } from "../../../identity";
import { AgentRun } from "../../domain/entities/agent-run";
import { planDiscovery } from "../../domain/policies/discovery.policy";
import { decideEscalation, type HandoffReason } from "../../domain/policies/escalation.policy";
import {
  billingPeriodOf,
  decideSpend,
  SpendVerdict,
  type SpendDecision,
} from "../../domain/policies/spend-limit.policy";
import type { UsageLedger } from "../ports/usage-ledger";
import { AgentStepType } from "../../domain/value-objects/agent-step";
import { classifyIntent, Intent } from "../../domain/value-objects/intent";
import { TurnBudget, type TurnBudgetLimits } from "../../domain/value-objects/turn-budget";
import { AgentRunCompleted, AgentRunFailed } from "../events/agent.events";
import { evaluateGuardrails, type Guardrail } from "../guardrails/guardrail";
import type { AgentRunRepository } from "../../domain/repositories/agent-run.repository";
import type { LLMProvider, LlmMessage, LlmUsage } from "../ports/llm-provider";
import type { SlotExtractor } from "../ports/slot-extractor";
import type { ContextBuilder } from "../runtime/context-builder";
import type { ToolRegistry } from "../runtime/tool-registry";
import type { HandoffCoordinator } from "../services/handoff-coordinator";

export interface RunAgentTurnCommand {
  readonly conversationId: string;
  readonly turnId: string;
  readonly contactId: string;
  readonly text: string;
  readonly correlationId: string;
}

export interface RunAgentTurnResult {
  readonly runId: string;
  readonly status: "COMPLETED" | "ESCALATED" | "SKIPPED";
  readonly reply: string;
  readonly toolCalls: number;
}

/**
 * `RunAgentTurn` — el caso de uso central del producto (docs §7.3).
 *
 * Su forma sigue el documento paso a paso: cargar contexto, preprocesar de
 * forma determinista, bucle de herramientas con presupuesto, guardrails,
 * composición de la respuesta y salida.
 *
 * Tres decisiones que merecen quedar por escrito:
 *
 * 1. **Lo determinista va antes que el modelo.** La intención se clasifica con
 *    reglas y el escalamiento explícito se resuelve SIN llamar al LLM. Un
 *    cliente que pide hablar con una persona la consigue en milisegundos y con
 *    coste cero. Dejarlo al modelo sería más caro, más lento y menos fiable.
 *
 * 2. **El presupuesto no es opcional.** Iteraciones, herramientas y tiempo.
 *    Agotarlo no deja al cliente sin respuesta: responde lo que tenga y escala.
 *
 * 3. **Nada se envía sin pasar por los guardrails.** Si bloquean, se reintenta
 *    UNA vez dándole al modelo la razón concreta. Si insiste, escala. El
 *    producto prefiere pasar la conversación a una persona antes que enviar un
 *    precio inventado.
 */
/**
 * Descarta las preguntas que quedaron resueltas dentro del mismo turno.
 *
 * Un turno puede encadenar herramientas: proponer horarios y, con la respuesta
 * del cliente ya sobre la mesa, agendar. Si se enviaran los bloques de las dos,
 * el cliente recibiría "elige un horario" seguido de "tu visita quedó
 * agendada", que es incoherente y le invita a contestar a una pregunta muerta.
 *
 * La regla es general y no habla de citas: un bloque interactivo al que le
 * sigue cualquier otro contenido ya no es una pregunta abierta.
 */
/**
 * Cuota del aviso de "vas muy rápido": una ficha cada diez minutos.
 *
 * Es el mismo cubo de fichas, usado para algo que no es un límite sino un
 * antirrebote. Que la primitiva sirva para las dos cosas sin código nuevo es la
 * señal de que estaba bien elegida.
 */
const NOTICE_QUOTA: Quota = { burst: 1, perMinute: 0.1 };

const pruneAnsweredPrompts = (blocks: readonly ReplyBlock[]): ReplyBlock[] => {
  const kept: ReplyBlock[] = [];

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind === "quick_replies" && kept.length > 0) continue;
    kept.unshift(block);
  }

  return kept;
};

export class RunAgentTurnUseCase {
  constructor(
    private readonly deps: {
      conversations: ConversationService;
      tenants: TenantDirectory;
      llm: LLMProvider;
      tools: ToolRegistry;
      contextBuilder: ContextBuilder;
      slotExtractor: SlotExtractor;
      guardrails: readonly Guardrail[];
      handoff: HandoffCoordinator;
      runs: AgentRunRepository;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      limits: TurnBudgetLimits;
      /** Contador de gasto por inmobiliaria. Protege la factura. */
      usage: UsageLedger;
      /** Tope mensual por defecto en USD. `0` o ausente = sin tope. */
      defaultMonthlyBudgetUsd?: number;
      /** Ritmo tolerado por contacto. Protege de un número que no para. */
      rateLimiter: RateLimiter;
      turnQuota: Quota;
      /**
       * Capacidades del canal por el que va la conversación. Se consultan por
       * conversación y no se fijan aquí: el mismo agente atiende una terminal
       * de texto plano y, en F6, WhatsApp con botones.
       */
      capabilitiesOf: (channelAccountId: string) => Promise<ChannelCapabilities>;
      maxPromptTokens?: number;
    },
  ) {}

  async execute(command: RunAgentTurnCommand): Promise<Result<RunAgentTurnResult, AppError>> {
    const startedAt = this.deps.clock.now();
    const budget = new TurnBudget(this.deps.limits, this.deps.clock.nowMs(), () =>
      this.deps.clock.nowMs(),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.deps.limits.timeoutMs);
    timer.unref();

    /* ── 1. Contexto ─────────────────────────────────────────────────────── */
    const contextResult = await this.deps.conversations.getContext(command.conversationId);
    if (isErr(contextResult)) {
      clearTimeout(timer);
      return contextResult;
    }
    let context = contextResult.value;

    if (context.status !== "OPEN") {
      // Un humano tomó la conversación entre que se agendó el turno y ahora.
      clearTimeout(timer);
      this.deps.logger.debug("Turno descartado: el bot no está al mando", {
        conversationId: command.conversationId,
        status: context.status,
      });
      return ok({ runId: "", status: "SKIPPED", reply: "", toolCalls: 0 });
    }

    /*
     * Ritmo del contacto. Va ANTES de cargar la inmobiliaria y de abrir una
     * ejecución: si este turno no se va a correr, lo más barato es descubrirlo
     * ya. No hay `AgentRun` que registrar porque no ha habido ejecución alguna.
     */
    const tenantId = TenantContext.requireTenantId();
    if (await this.throttled(tenantId, command)) {
      clearTimeout(timer);
      return ok({ runId: "", status: "SKIPPED", reply: "", toolCalls: 0 });
    }

    // El tenant sale del ámbito de ejecución, nunca de datos de la conversación.
    const tenant = await this.deps.tenants.requireActive(tenantId);
    const capabilities = await this.deps.capabilitiesOf(context.channelAccountId);

    const run = AgentRun.start({
      id: this.deps.ids.generate(),
      tenantId: tenant.id,
      conversationId: command.conversationId,
      turnId: command.turnId,
      // Se rellena al renderizar el prompt; un turno escalado antes de llamar
      // al modelo no usa ninguno.
      promptVersion: "none",
      now: startedAt,
    });

    try {
      /* ── 2. Preprocesado determinista ──────────────────────────────────── */
      const intent = classifyIntent(command.text);
      context = await this.rememberInferredSlots(command, context, intent, run);

      /*
       * Tope de gasto del mes. Se comprueba ANTES de llamar al modelo, que es
       * el único momento en el que sirve de algo, y agotarlo NO deja al cliente
       * sin respuesta: pasa la conversación a una persona. Un agente que se
       * queda mudo porque su inmobiliaria se pasó del presupuesto parece un
       * producto roto; uno que dice "te paso con un asesor" parece un producto.
       */
      const spend = await this.checkSpendLimit(tenant, startedAt);

      const preEscalation = decideEscalation({
        intent,
        consecutiveFailedTurns: 0,
        maxConsecutiveFailedTurns: tenant.settings.maxConsecutiveFailedTurns,
        providerFailed: false,
        guardrailBlocked: false,
        budgetExhausted: spend.verdict === SpendVerdict.BLOCK,
      });

      if (preEscalation.escalate && preEscalation.reason) {
        // Sin llamar al modelo: coste cero y respuesta inmediata.
        const outcome = await this.escalate(run, command, preEscalation.reason);
        clearTimeout(timer);
        return ok(outcome);
      }

      /* ── 3. Bucle de tool calling ──────────────────────────────────────── */
      const plan = planDiscovery(context.profile);
      const built = this.deps.contextBuilder.build({
        conversation: context,
        tenant: {
          name: tenant.name,
          currency: tenant.currency,
          agentDisplayName: tenant.settings.agentDisplayName,
          tone: tenant.settings.tone,
        },
        plan,
        capabilities,
        turnText: command.text,
        maxPromptTokens: this.deps.maxPromptTokens ?? 6000,
      });

      run.recordPromptVersion(built.promptVersion);

      const messages: LlmMessage[] = [...built.messages];
      const toolOutputs: string[] = [];
      /**
       * Bloques que produjeron las herramientas con SUS datos. Las fichas de
       * inmueble salen de aquí, no del texto del modelo (docs §7.3, paso 5).
       */
      const toolBlocks: ReplyBlock[] = [];
      let draft = "";
      let providerFailed = false;

      while (budget.exhausted() === null) {
        budget.startIteration();

        const generatedAt = this.deps.clock.nowMs();
        const generated = await this.deps.llm.generate({
          messages,
          tools: this.deps.tools.schemasFor(),
          temperature: 0.3,
          maxOutputTokens: 600,
          abortSignal: controller.signal,
        });

        if (isErr(generated)) {
          providerFailed = true;
          run.addStep({
            type: AgentStepType.THOUGHT,
            payload: { errorCode: generated.error.code },
            durationMs: this.deps.clock.nowMs() - generatedAt,
            at: this.deps.clock.now(),
            error: generated.error.message,
          });
          break;
        }

        const response = generated.value;
        run.recordUsage(response.usage, response.model);
        run.addStep({
          type: AgentStepType.THOUGHT,
          payload: { content: response.content, toolCalls: response.toolCalls.map((c) => c.name) },
          durationMs: this.deps.clock.nowMs() - generatedAt,
          at: this.deps.clock.now(),
        });

        if (response.toolCalls.length === 0) {
          draft = response.content;
          break;
        }

        // Recorta si el modelo pide más herramientas de las que quedan.
        const calls = response.toolCalls.slice(0, budget.remainingToolCalls);
        budget.registerToolCalls(calls.length);

        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: calls,
        });

        for (const call of calls) {
          run.addStep({
            type: AgentStepType.TOOL_CALL,
            name: call.name,
            payload: { arguments: call.arguments },
            durationMs: 0,
            at: this.deps.clock.now(),
          });

          const execution = await this.deps.tools.execute(call, {
            tenantId: tenant.id,
            conversationId: command.conversationId,
            contactId: command.contactId,
            correlationId: command.correlationId,
            logger: this.deps.logger,
            abortSignal: controller.signal,
          });

          const serialized = JSON.stringify(execution.result);
          toolOutputs.push(serialized);
          if (execution.result.ok && execution.result.blocks) {
            toolBlocks.push(...execution.result.blocks);
          }

          run.addStep({
            type: AgentStepType.TOOL_RESULT,
            name: call.name,
            payload: { result: execution.result },
            durationMs: execution.durationMs,
            at: this.deps.clock.now(),
            ...(execution.result.ok ? {} : { error: execution.result.message }),
          });

          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: serialized,
          });
        }
      }

      /* ── 4. Guardrails ─────────────────────────────────────────────────── */
      const budgetStop = budget.exhausted();
      let outcome = evaluateGuardrails(this.deps.guardrails, {
        draft,
        toolOutputs,
        maxLength: capabilities.maxTextLength,
      });

      if (outcome.blocked && outcome.feedback && budget.exhausted() === null) {
        // Un reintento, con la razón concreta. Los modelos se corrigen bien
        // cuando se les dice exactamente qué hicieron mal.
        run.addStep({
          type: AgentStepType.GUARDRAIL,
          name: outcome.violations[0]?.name,
          payload: { violations: outcome.violations, retry: true },
          durationMs: 0,
          at: this.deps.clock.now(),
        });

        messages.push({ role: "assistant", content: draft });
        messages.push({ role: "user", content: outcome.feedback });

        budget.startIteration();
        const retry = await this.deps.llm.generate({
          messages,
          tools: [],
          temperature: 0.1,
          maxOutputTokens: 400,
          abortSignal: controller.signal,
        });

        if (!isErr(retry)) {
          run.recordUsage(retry.value.usage, retry.value.model);
          outcome = evaluateGuardrails(this.deps.guardrails, {
            draft: retry.value.content,
            toolOutputs,
            maxLength: capabilities.maxTextLength,
          });
        }
      }

      /* ── 5-6. Escalar o responder ──────────────────────────────────────── */
      const postEscalation = decideEscalation({
        intent,
        consecutiveFailedTurns: 0,
        maxConsecutiveFailedTurns: tenant.settings.maxConsecutiveFailedTurns,
        providerFailed,
        guardrailBlocked: outcome.blocked,
        budgetExhausted: budgetStop !== null && outcome.text.length === 0,
      });

      if (postEscalation.escalate && postEscalation.reason) {
        const escalated = await this.escalate(run, command, postEscalation.reason);
        clearTimeout(timer);
        return ok(escalated);
      }

      const replyText =
        outcome.text.trim().length > 0
          ? outcome.text
          : "Perdona, se me cruzaron los cables. ¿Me lo repites?";

      const blocks = this.compose(replyText, plan, toolBlocks);
      await this.deliver(command, blocks, run, replyText);

      run.complete(this.deps.clock.now());
      await this.persist(run, command, budget);
      clearTimeout(timer);

      return ok({
        runId: run.id,
        status: "COMPLETED",
        reply: replyText,
        toolCalls: budget.usedToolCalls,
      });
    } catch (error) {
      clearTimeout(timer);
      const reason = error instanceof Error ? error.message : String(error);
      run.fail(reason, this.deps.clock.now());
      await this.deps.runs.save(run);
      await this.deps.events.publish(AgentRunFailed, {
        runId: run.id,
        conversationId: command.conversationId,
        turnId: command.turnId,
        errorCode: "AGENT_TURN_FAILED",
        reason,
      });
      throw error;
    } finally {
      /*
       * Un único sitio para anotar el gasto, y por eso va en el `finally`: el
       * turno puede terminar completado, escalado o reventado, y en los tres
       * casos ya se llamó al modelo y ya se pagó. Anotarlo solo en el camino
       * feliz dejaría fuera justo los turnos que más se repiten cuando algo va
       * mal — que son los que disparan una factura.
       */
      await this.recordSpend(tenant, startedAt, run.usage);
    }
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Extracción determinista previa. Lo que se deduce por reglas se marca como
   * `inferred`: si el modelo luego confirma lo mismo por la herramienta, su
   * valor `user` gana y el perfil queda con la procedencia correcta.
   */
  /**
   * Gasto del periodo frente al tope de la inmobiliaria.
   *
   * El tope propio de la inmobiliaria manda sobre el global; sin ninguno de los
   * dos no hay tope, y eso es deliberado (ver `spend-limit.policy`).
   *
   * Si el contador falla —la base tose, la tabla no está migrada— se DEJA
   * PASAR el turno y se registra el fallo. Es una decisión consciente: quedarse
   * sin atender a los clientes de todas las inmobiliarias porque no se pudo
   * leer un contador es un daño mayor que un rato sin tope.
   */
  /**
   * ¿Este contacto está pidiendo turnos más deprisa de lo razonable?
   *
   * **Qué protege exactamente.** Las ráfagas cortas —cinco mensajes seguidos
   * mientras alguien piensa en voz alta— ya las une el debounce de turnos: eso
   * es UN turno, no cinco, y está bien así. Lo que esto corta es lo SOSTENIDO:
   * un número que manda un mensaje cada pocos segundos durante una hora. Ahí no
   * hay un cliente escribiendo, hay un bucle o un abuso, y cada turno cuesta
   * dinero y ocupa un hueco que necesita alguien de verdad.
   *
   * **Por qué se salta el turno en vez de escalar.** El tope de gasto escala a
   * una persona porque el problema es de la inmobiliaria y hay que avisarla.
   * Aquí el problema es un solo contacto, y mandar a un asesor cada número que
   * insiste convertiría el abuso en una forma de inundar el buzón del equipo.
   * Los mensajes del cliente están todos guardados y la conversación sigue
   * abierta: no se pierde nada, solo se deja de generar.
   *
   * **Y se avisa una sola vez.** El aviso sale de su propio cubo de una ficha
   * cada diez minutos: quien se pasa recibe una explicación, no un eco de su
   * propia insistencia. Repetirlo en cada mensaje bloqueado sería duplicar el
   * problema por el otro lado —y en WhatsApp, además, pagar por hacerlo.
   */
  private async throttled(tenantId: string, command: RunAgentTurnCommand): Promise<boolean> {
    let decision;
    try {
      decision = await this.deps.rateLimiter.consume({
        key: `turn:${tenantId}:${command.contactId}`,
        quota: this.deps.turnQuota,
      });
    } catch (error) {
      // No poder medir el ritmo no puede dejar a un cliente sin respuesta.
      this.deps.logger.error("No se pudo medir el ritmo: el turno sigue sin límite", {
        conversationId: command.conversationId,
        err: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    if (decision.allowed) return false;

    this.deps.logger.warn("Turno omitido por ritmo del contacto", {
      tenantId,
      conversationId: command.conversationId,
      contactId: command.contactId,
      retryAfterMs: decision.retryAfterMs,
    });

    const notice = await this.deps.rateLimiter
      .consume({ key: `turn-notice:${tenantId}:${command.contactId}`, quota: NOTICE_QUOTA })
      .catch(() => ({ allowed: false, remaining: 0, retryAfterMs: 0 }));

    if (notice.allowed) {
      // `SYSTEM` y no `AGENT`: no es el agente hablando, es la plataforma
      // explicando por qué no lo hace.
      await this.deps.conversations.reply({
        conversationId: command.conversationId,
        blocks: [
          textBlock(
            "Estoy recibiendo muchos mensajes seguidos y necesito un momento. " +
              "Escríbeme en un minuto y seguimos.",
          ),
        ],
        authorType: MessageAuthorType.SYSTEM,
      });
    }

    return true;
  }

  private async checkSpendLimit(
    tenant: TenantView,
    now: Date,
  ): Promise<SpendDecision> {
    const limitUsd = tenant.settings.monthlyBudgetUsd ?? this.deps.defaultMonthlyBudgetUsd ?? 0;
    const period = billingPeriodOf(now, tenant.timezone);

    let spentUsd = 0;
    try {
      spentUsd = (await this.deps.usage.spendIn(period)).spentUsd;
    } catch (error) {
      this.deps.logger.error("No se pudo leer el consumo: el turno sigue sin tope", {
        tenantId: tenant.id,
        period,
        err: error instanceof Error ? error.message : String(error),
      });
      return { verdict: SpendVerdict.ALLOW, ratio: 0, spentUsd: 0, limitUsd };
    }

    const decision = decideSpend({ spentUsd, limitUsd });

    if (decision.verdict !== SpendVerdict.ALLOW) {
      this.deps.logger.warn("La inmobiliaria está en su tope de gasto", {
        tenantId: tenant.id,
        period,
        verdict: decision.verdict,
        spentUsd: decision.spentUsd,
        limitUsd: decision.limitUsd,
      });
    }

    return decision;
  }

  /**
   * Anota lo gastado en el turno.
   *
   * No se reserva presupuesto por adelantado: un turno puede pasar el tope por
   * lo que gaste él mismo, y está bien — el tope acota el mes, no el turno.
   * Para acotar el turno ya está `TurnBudget`.
   *
   * Un fallo aquí no puede tumbar una respuesta que el cliente ya ha recibido:
   * se registra y se sigue.
   */
  private async recordSpend(tenant: TenantView, now: Date, usage: LlmUsage): Promise<void> {
    if (usage.promptTokens === 0 && usage.completionTokens === 0) return;

    try {
      await this.deps.usage.record({ period: billingPeriodOf(now, tenant.timezone), usage });
    } catch (error) {
      this.deps.logger.error("No se pudo anotar el consumo del turno", {
        tenantId: tenant.id,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async rememberInferredSlots(
    command: RunAgentTurnCommand,
    context: ConversationContext,
    intent: Intent,
    run: AgentRun,
  ): Promise<ConversationContext> {
    if (intent === Intent.HANDOFF || intent === Intent.OUT_OF_SCOPE) return context;

    const extracted = await this.deps.slotExtractor.extract(command.text);
    if (Object.keys(extracted).length === 0) return context;

    const now = this.deps.clock.now();
    const slots: ProfileSlots = {};
    for (const [name, value] of Object.entries(extracted)) {
      if (value === undefined) continue;
      (slots as Record<string, unknown>)[name] = slot(value, SlotSource.INFERRED, now);
    }

    const remembered = await this.deps.conversations.remember({
      contactId: command.contactId,
      slots,
    });

    if (isErr(remembered) || remembered.value.length === 0) return context;

    run.addStep({
      type: AgentStepType.THOUGHT,
      name: "slot_extractor",
      payload: { inferred: remembered.value.map((change) => change.slot) },
      durationMs: 0,
      at: now,
    });

    const refreshed = await this.deps.conversations.getContext(command.conversationId);
    return isErr(refreshed) ? context : refreshed.value;
  }

  /**
   * Composición de la respuesta (docs §7.3, paso 5).
   *
   * Cuando toca preguntar la operación, se ofrecen botones. El canal que no los
   * soporte los verá como lista numerada — el agente no se entera y no le
   * importa.
   */
  private compose(
    text: string,
    plan: ReturnType<typeof planDiscovery>,
    toolBlocks: readonly ReplyBlock[],
  ): ReplyBlock[] {
    // Primero lo que dice el modelo, luego los datos. El texto introduce; las
    // fichas llevan los números, y esos no los ha escrito el modelo.
    const blocks: ReplyBlock[] = [textBlock(text), ...pruneAnsweredPrompts(toolBlocks)];

    if (toolBlocks.length === 0 && plan.ask.length === 1 && plan.ask[0] === "operation") {
      blocks.push(
        quickRepliesBlock("¿Qué necesitas?", [
          { label: "Comprar", value: "SALE" },
          { label: "Arrendar", value: "RENT" },
        ]),
      );
    }

    return blocks;
  }

  private async deliver(
    command: RunAgentTurnCommand,
    blocks: readonly ReplyBlock[],
    run: AgentRun,
    text: string,
  ): Promise<void> {
    run.addStep({
      type: AgentStepType.MESSAGE,
      payload: { text, blocks: blocks.length },
      durationMs: 0,
      at: this.deps.clock.now(),
    });

    const delivered = await this.deps.conversations.reply({
      conversationId: command.conversationId,
      blocks,
      authorType: MessageAuthorType.AGENT,
    });

    if (isErr(delivered)) {
      this.deps.logger.warn("No se pudo entregar la respuesta del agente", {
        conversationId: command.conversationId,
        errorCode: delivered.error.code,
      });
    }
  }

  /**
   * Escalamiento. NO se pasa el nombre del agente como asesor: el bot no puede
   * decir "te comunico con Sofía" siendo Sofía él mismo. El nombre real del
   * asesor llegará con la cola de atención humana (F7); hasta entonces, el
   * genérico "un asesor" es lo único cierto.
   */
  private async escalate(
    run: AgentRun,
    command: RunAgentTurnCommand,
    reason: HandoffReason,
  ): Promise<RunAgentTurnResult> {
    run.addStep({
      type: AgentStepType.GUARDRAIL,
      name: "escalation",
      payload: { reason },
      durationMs: 0,
      at: this.deps.clock.now(),
    });

    const outcome = await this.deps.handoff.request({
      conversationId: command.conversationId,
      contactId: command.contactId,
      reason,
    });

    // El aviso se envía con `authorType: SYSTEM` porque el bot ya está pausado:
    // es la plataforma la que habla, no el agente.
    await this.deps.conversations.reply({
      conversationId: command.conversationId,
      blocks: [textBlock(outcome.message)],
      authorType: MessageAuthorType.SYSTEM,
    });

    run.escalate(reason, this.deps.clock.now());
    await this.deps.runs.save(run);
    await this.publishCompleted(run, command, 0);

    return { runId: run.id, status: "ESCALATED", reply: outcome.message, toolCalls: 0 };
  }

  private async persist(
    run: AgentRun,
    command: RunAgentTurnCommand,
    budget: TurnBudget,
  ): Promise<void> {
    await this.deps.runs.save(run);
    await this.publishCompleted(run, command, budget.usedToolCalls);
  }

  private async publishCompleted(
    run: AgentRun,
    command: RunAgentTurnCommand,
    toolCalls: number,
  ): Promise<void> {
    await this.deps.events.publish(AgentRunCompleted, {
      runId: run.id,
      conversationId: command.conversationId,
      turnId: command.turnId,
      status: run.status === "ESCALATED" ? "ESCALATED" : "COMPLETED",
      model: run.model,
      promptTokens: run.usage.promptTokens,
      completionTokens: run.usage.completionTokens,
      estimatedCostUsd: run.usage.estimatedCostUsd,
      latencyMs: run.snapshot().latencyMs ?? 0,
      toolCalls,
    });
  }
}
