import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import {
  slot,
  SlotSource,
  type ConversationService,
  type MoneyRange,
  type ProfileSlots,
} from "../../../conversation";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

/**
 * Esquema de argumentos. Es a la vez la validación en ejecución y el JSON
 * Schema que ve el modelo: no pueden divergir porque son el mismo objeto.
 *
 * Fíjate en lo que NO está: `tenantId`, `contactId`, `conversationId`. El
 * modelo no los ve ni los puede falsificar (docs §8.1).
 */
export const savePreferencesSchema = z.object({
  name: z.string().min(2).max(80).optional().describe("Nombre del cliente, si lo dijo"),
  operation: z.enum(["SALE", "RENT"]).optional().describe("SALE si compra, RENT si arrienda"),
  propertyType: z
    .array(z.enum(["APARTMENT", "HOUSE", "STUDIO", "OFFICE", "COMMERCIAL", "LOT", "WAREHOUSE", "FARM"]))
    .optional()
    .describe("Tipos de inmueble que le interesan"),
  city: z.string().min(2).max(60).optional().describe("Ciudad o municipio"),
  neighborhoods: z.array(z.string().min(2).max(60)).optional().describe("Barrios o zonas"),
  budget: z
    .object({
      min: z.number().int().positive().optional(),
      max: z.number().int().positive().optional(),
      // Sin `.default()`: haría que el tipo de entrada y el de salida del
      // esquema divergieran, y el contrato de la herramienta usa uno solo.
      currency: z.string().length(3).optional(),
    })
    .optional()
    .describe("Presupuesto en unidades mínimas de la moneda (centavos). Moneda ISO, COP si no se dice"),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(20).optional(),
  timeline: z.enum(["now", "1-3m", "3-6m", "exploring"]).optional(),
  financing: z.enum(["cash", "mortgage", "unknown"]).optional(),
  note: z.string().max(300).optional().describe("Algo relevante que no encaje en los campos"),
});

export type SavePreferencesArgs = z.infer<typeof savePreferencesSchema>;

export interface SavePreferencesResult {
  readonly saved: readonly string[];
  readonly stillMissing: readonly string[];
}

/**
 * `save_customer_preferences` — cómo el agente recuerda.
 *
 * El modelo propone; la política de fusión del dominio decide. Lo que llega
 * por aquí se marca como `user` porque el modelo lo dedujo de lo que el cliente
 * escribió explícitamente, y por eso gana sobre lo que el extractor por reglas
 * haya deducido antes (docs §11.1).
 *
 * Es una herramienta de escritura, pero idempotente por naturaleza: guardar dos
 * veces el mismo valor no produce ningún cambio, y la fusión lo ignora.
 */
export const createSavePreferencesTool = (deps: {
  conversations: ConversationService;
}): AgentTool<SavePreferencesArgs, SavePreferencesResult> => ({
  name: "save_customer_preferences",
  description:
    "Guarda lo que el cliente ha dicho que busca (operación, ciudad, zonas, tipo de inmueble, " +
    "presupuesto, habitaciones, urgencia). Úsala EN CUANTO el cliente mencione cualquiera de " +
    "estos datos, aunque sea de pasada. No inventes valores: guarda solo lo que dijo.",
  parameters: savePreferencesSchema,
  sideEffect: "write",

  async execute(
    args: SavePreferencesArgs,
    context: ToolContext,
  ): Promise<ToolResult<SavePreferencesResult>> {
    const now = new Date();
    const slots: ProfileSlots = {};

    if (args.name !== undefined) slots.name = slot(args.name, SlotSource.USER, now);
    if (args.operation !== undefined) slots.operation = slot(args.operation, SlotSource.USER, now);
    if (args.propertyType !== undefined) {
      slots.propertyType = slot(args.propertyType, SlotSource.USER, now);
    }
    if (args.city !== undefined) slots.city = slot(args.city, SlotSource.USER, now);
    if (args.neighborhoods !== undefined) {
      slots.neighborhoods = slot(args.neighborhoods, SlotSource.USER, now);
    }
    if (args.budget !== undefined) {
      // Se construye campo a campo: con `exactOptionalPropertyTypes`, un
      // `min: undefined` explícito no es lo mismo que no tener `min`.
      const budget: MoneyRange = {
        currency: (args.budget.currency ?? "COP").toUpperCase(),
        ...(args.budget.min !== undefined ? { min: args.budget.min } : {}),
        ...(args.budget.max !== undefined ? { max: args.budget.max } : {}),
      };
      slots.budget = slot(budget, SlotSource.USER, now);
    }
    if (args.bedrooms !== undefined) slots.bedrooms = slot(args.bedrooms, SlotSource.USER, now);
    if (args.bathrooms !== undefined) slots.bathrooms = slot(args.bathrooms, SlotSource.USER, now);
    if (args.timeline !== undefined) slots.timeline = slot(args.timeline, SlotSource.USER, now);
    if (args.financing !== undefined) slots.financing = slot(args.financing, SlotSource.USER, now);

    const result = await deps.conversations.remember({
      contactId: context.contactId,
      slots,
      ...(args.note ? { note: args.note } : {}),
    });

    if (isErr(result)) {
      return toolError("MEMORY_WRITE_FAILED", "No se pudo guardar la preferencia", true);
    }

    const saved = result.value.map((change) => change.slot);
    const contextAfter = await deps.conversations.getContext(context.conversationId);
    const stillMissing = isErr(contextAfter) ? [] : contextAfter.value.missingRequiredSlots;

    return toolOk(
      { saved, stillMissing },
      saved.length > 0 ? `Guardado: ${saved.join(", ")}` : "Nada nuevo que guardar",
    );
  },
});
