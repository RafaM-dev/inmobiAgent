import { InvariantViolationError } from "../../../../platform/errors/app-error";
import { truncate, type AgentStep, type AgentStepType } from "../value-objects/agent-step";

export const AgentRunStatus = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  /** Terminó, pero derivando la conversación a una persona. */
  ESCALATED: "ESCALATED",
  FAILED: "FAILED",
} as const;
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

export interface AgentRunUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedCostUsd: number;
}

export interface AgentRunProps {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  /** Turno que originó esta ejecución. Uno a uno. */
  readonly turnId: string;
  readonly status: AgentRunStatus;
  readonly steps: readonly AgentStep[];
  readonly usage: AgentRunUsage;
  readonly model: string | undefined;
  readonly promptVersion: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | undefined;
  readonly latencyMs: number | undefined;
  readonly failureReason: string | undefined;
  readonly escalationReason: string | undefined;
}

/**
 * AgentRun: una ejecución del agente para un turno.
 *
 * Es un agregado y no un registro de log porque tiene invariantes que importan:
 * un run terminado no admite más pasos, y el consumo se acumula aquí para que
 * el control de coste por tenant (F9) tenga una única fuente de verdad.
 *
 * Se persiste SIEMPRE, también cuando falla. Un turno que reventó y no dejó
 * rastro es un turno que nadie podrá depurar.
 */
export class AgentRun {
  private constructor(private props: AgentRunProps) {}

  static start(input: {
    id: string;
    tenantId: string;
    conversationId: string;
    turnId: string;
    promptVersion: string;
    now: Date;
  }): AgentRun {
    return new AgentRun({
      id: input.id,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      status: AgentRunStatus.RUNNING,
      steps: [],
      usage: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
      model: undefined,
      promptVersion: input.promptVersion,
      startedAt: input.now,
      finishedAt: undefined,
      latencyMs: undefined,
      failureReason: undefined,
      escalationReason: undefined,
    });
  }

  static rehydrate(props: AgentRunProps): AgentRun {
    return new AgentRun(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get conversationId(): string {
    return this.props.conversationId;
  }
  get turnId(): string {
    return this.props.turnId;
  }
  get status(): AgentRunStatus {
    return this.props.status;
  }
  get steps(): readonly AgentStep[] {
    return this.props.steps;
  }
  get usage(): AgentRunUsage {
    return this.props.usage;
  }
  get model(): string | undefined {
    return this.props.model;
  }
  get isFinished(): boolean {
    return this.props.status !== AgentRunStatus.RUNNING;
  }

  addStep(input: {
    type: AgentStepType;
    name?: string | undefined;
    payload: Record<string, unknown>;
    durationMs: number;
    at: Date;
    error?: string | undefined;
  }): void {
    if (this.isFinished) {
      throw new InvariantViolationError("No se pueden añadir pasos a un run terminado", {
        runId: this.props.id,
      });
    }

    const step: AgentStep = {
      ordinal: this.props.steps.length,
      type: input.type,
      name: input.name,
      payload: truncate(input.payload) as Record<string, unknown>,
      durationMs: input.durationMs,
      at: input.at,
      error: input.error,
    };
    this.props = { ...this.props, steps: [...this.props.steps, step] };
  }

  /**
   * Se fija al renderizar el prompt, no al arrancar el run: un turno que se
   * escala antes de llamar al modelo no usó ningún prompt, y decir que sí
   * ensuciaría el histórico que sirve para comparar versiones.
   */
  recordPromptVersion(version: string): void {
    this.props = { ...this.props, promptVersion: version };
  }

  recordUsage(usage: AgentRunUsage, model: string): void {
    this.props = {
      ...this.props,
      model,
      usage: {
        promptTokens: this.props.usage.promptTokens + usage.promptTokens,
        completionTokens: this.props.usage.completionTokens + usage.completionTokens,
        estimatedCostUsd: this.props.usage.estimatedCostUsd + usage.estimatedCostUsd,
      },
    };
  }

  complete(now: Date): void {
    this.finish(AgentRunStatus.COMPLETED, now, {});
  }

  escalate(reason: string, now: Date): void {
    this.finish(AgentRunStatus.ESCALATED, now, { escalationReason: reason });
  }

  fail(reason: string, now: Date): void {
    this.finish(AgentRunStatus.FAILED, now, { failureReason: reason });
  }

  private finish(
    status: AgentRunStatus,
    now: Date,
    extra: { escalationReason?: string; failureReason?: string },
  ): void {
    if (this.isFinished) return;
    this.props = {
      ...this.props,
      status,
      finishedAt: now,
      latencyMs: now.getTime() - this.props.startedAt.getTime(),
      escalationReason: extra.escalationReason,
      failureReason: extra.failureReason,
    };
  }

  snapshot(): AgentRunProps {
    return { ...this.props, steps: [...this.props.steps] };
  }
}
