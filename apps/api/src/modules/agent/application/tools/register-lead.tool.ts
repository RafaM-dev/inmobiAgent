import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import type { LeadService } from "../../../leads";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

export const registerLeadSchema = z.object({
  visitRequested: z
    .boolean()
    .optional()
    .describe("true si el cliente ha dicho que quiere ver algún inmueble"),
  marketingConsent: z
    .boolean()
    .optional()
    .describe("true solo si el cliente aceptó EXPLÍCITAMENTE recibir novedades"),
});

export type RegisterLeadArgs = z.infer<typeof registerLeadSchema>;

export interface RegisterLeadToolResult {
  readonly leadId: string;
  readonly status: string;
  readonly score: number;
  readonly band: string;
  readonly created: boolean;
}

/**
 * `register_lead` — deja la ficha comercial creada o actualizada.
 *
 * Fíjate en lo que NO recibe: ni nombre, ni ciudad, ni presupuesto. Todo eso lo
 * lee el caso de uso de la memoria de la conversación, que es donde vive lo que
 * el cliente dijo de verdad. Si el modelo pudiera pasar los datos, un turno con
 * mala suerte metería en el CRM una ciudad que nadie mencionó.
 *
 * Es idempotente por conversación: llamarla de más no cuesta nada. Y **no es la
 * única vía de captura** — mostrar inmuebles ya crea la ficha por evento. Esta
 * herramienta existe para el caso en que el cliente se identifica o da su
 * consentimiento antes de ver nada.
 */
export const createRegisterLeadTool = (deps: {
  leads: LeadService;
}): AgentTool<RegisterLeadArgs, RegisterLeadToolResult> => ({
  name: "register_lead",
  description:
    "Registra al cliente como oportunidad comercial para que un asesor le dé seguimiento. " +
    "Úsala cuando el cliente muestre interés real: deja su nombre, dice qué busca con claridad " +
    "o pide ver un inmueble. Los datos se toman de la conversación; tú no los pasas.",
  parameters: registerLeadSchema,
  sideEffect: "write",

  async execute(
    args: RegisterLeadArgs,
    context: ToolContext,
  ): Promise<ToolResult<RegisterLeadToolResult>> {
    const captured = await deps.leads.capture({
      conversationId: context.conversationId,
      contactId: context.contactId,
      ...(args.visitRequested === true ? { visitRequested: true } : {}),
      // El consentimiento de marketing NUNCA se asume: si el modelo no lo
      // afirma explícitamente, no se toca lo que ya hubiera.
      ...(args.marketingConsent !== undefined
        ? { consent: { dataProcessing: true, marketing: args.marketingConsent } }
        : {}),
    });

    if (isErr(captured)) {
      return toolError(
        "LEAD_CAPTURE_FAILED",
        "No pude registrar al cliente. Sigue atendiéndolo con normalidad.",
        true,
      );
    }

    const lead = captured.value;
    return toolOk(
      {
        leadId: lead.id,
        status: lead.status,
        score: lead.score,
        band: lead.band,
        created: lead.created,
      },
      lead.created ? "Cliente registrado" : "Ficha del cliente actualizada",
    );
  },
});
