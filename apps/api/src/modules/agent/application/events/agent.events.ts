import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `agent`.
 *
 * `HandoffRequested` es el que abrirá la cola de atención humana cuando exista
 * el módulo `handoff` (F7). Hoy nadie lo consume, y publicarlo igualmente no es
 * desperdicio: el día que ese módulo aparezca, no habrá que tocar el agente.
 */

export interface AgentRunCompletedPayload {
  readonly runId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: "COMPLETED" | "ESCALATED";
  readonly model: string | undefined;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly toolCalls: number;
}

export const AgentRunCompleted = defineEvent<AgentRunCompletedPayload>("agent.run_completed");

export interface AgentRunFailedPayload {
  readonly runId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly errorCode: string;
  readonly reason: string;
}

export const AgentRunFailed = defineEvent<AgentRunFailedPayload>("agent.run_failed");

export interface HandoffRequestedPayload {
  readonly conversationId: string;
  readonly contactId: string;
  readonly reason: string;
  readonly note?: string;
}

export const HandoffRequested = defineEvent<HandoffRequestedPayload>("agent.handoff_requested");
