import { z } from "zod";
import { HandoffReason } from "../../domain/policies/escalation.policy";
import { toolOk, type AgentTool, type ToolContext, type ToolResult } from "../ports/agent-tool";
import type { HandoffCoordinator } from "../services/handoff-coordinator";

export const requestHumanSchema = z.object({
  reason: z
    .enum([
      HandoffReason.USER_REQUEST,
      HandoffReason.OUT_OF_SCOPE,
      HandoffReason.BUSINESS_RULE,
      HandoffReason.TOOL_FAILURE,
    ])
    .describe("Por qué hace falta una persona"),
  note: z.string().max(300).optional().describe("Contexto breve para el asesor"),
});

export type RequestHumanArgs = z.infer<typeof requestHumanSchema>;

/**
 * `request_human_agent` — la salida de emergencia.
 *
 * Deliberadamente fácil de usar y sin condiciones: la descripción le dice al
 * modelo que la use SIN dudar. Es preferible escalar de más que dejar a un
 * cliente atrapado hablando con un bot que no le entiende.
 */
export const createRequestHumanTool = (deps: {
  handoff: HandoffCoordinator;
  advisorName?: string;
}): AgentTool<RequestHumanArgs, { reason: string; message: string }> => ({
  name: "request_human_agent",
  description:
    "Pasa la conversación a un asesor humano. Úsala sin dudarlo si el cliente lo pide, si el " +
    "tema se sale de tu alcance (temas legales, jurídicos, quejas, negociación de precio) o si " +
    "no puedes ayudarle de verdad. No insistas ni intentes retenerlo.",
  parameters: requestHumanSchema,
  sideEffect: "write",

  async execute(
    args: RequestHumanArgs,
    context: ToolContext,
  ): Promise<ToolResult<{ reason: string; message: string }>> {
    const outcome = await deps.handoff.request({
      conversationId: context.conversationId,
      contactId: context.contactId,
      reason: args.reason,
      ...(deps.advisorName ? { advisorName: deps.advisorName } : {}),
      ...(args.note ? { note: args.note } : {}),
    });

    return toolOk(
      { reason: outcome.reason, message: outcome.message },
      "Conversación derivada a un asesor",
    );
  },
});
