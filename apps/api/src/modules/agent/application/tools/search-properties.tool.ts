import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import type { ReplyBlock } from "../../../channels";
import { toPropertyCard, type CatalogService, type Property } from "../../../catalog";
import type { ConversationService } from "../../../conversation";
import { toSearchCriteria } from "../mappers/preferences-to-criteria.mapper";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

/**
 * Cuántas opciones se presentan de una vez (docs §12.1, etapa PRESENTING).
 * Más de cinco en un chat no se leen: se ignoran.
 */
const MAX_PRESENTED = 4;

export const searchPropertiesSchema = z.object({
  city: z.string().min(2).max(60).optional().describe("Ciudad; si se omite, la del perfil"),
  neighborhoods: z.array(z.string().min(2).max(60)).max(5).optional(),
  maxPrice: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Techo de precio en unidades mínimas de la moneda"),
  bedroomsMin: z.number().int().min(0).max(20).optional(),
  features: z.array(z.string().min(2).max(40)).max(6).optional(),
});

export type SearchPropertiesArgs = z.infer<typeof searchPropertiesSchema>;

export interface SearchPropertiesToolResult {
  readonly count: number;
  readonly hasMore: boolean;
  /** Referencias mostradas, para que el modelo pueda hablar de una en concreto. */
  readonly refs: readonly string[];
  /** Datos que el modelo PUEDE citar: los guardrails validan contra esto. */
  readonly items: readonly Record<string, unknown>[];
}

/**
 * `search_properties` — la herramienta que hace útil al agente.
 *
 * Dos decisiones importantes:
 *
 * 1. **Los criterios salen del perfil, no de lo que el modelo recuerde.** Los
 *    argumentos solo pueden *refinar* ("y que tenga parqueadero"). Así, si el
 *    modelo se olvida de la ciudad a mitad de conversación, la búsqueda sigue
 *    siendo la correcta.
 *
 * 2. **La herramienta devuelve las fichas ya renderizadas.** El modelo escribe
 *    la frase que las presenta; los precios, las áreas y las direcciones viajan
 *    en bloques construidos aquí a partir de la respuesta del proveedor. Es
 *    imposible que invente un precio en una ficha, porque no las escribe él.
 */
export const createSearchPropertiesTool = (deps: {
  catalog: CatalogService;
  conversations: ConversationService;
}): AgentTool<SearchPropertiesArgs, SearchPropertiesToolResult> => ({
  name: "search_properties",
  description:
    "Busca inmuebles que encajen con lo que el cliente ha dicho que quiere. Úsala en cuanto " +
    "sepas la operación (comprar/arrendar) y al menos la ciudad. Los argumentos son solo para " +
    "refinar o corregir; lo demás se toma de lo que ya sabes del cliente.",
  parameters: searchPropertiesSchema,
  sideEffect: "none",

  async execute(
    args: SearchPropertiesArgs,
    context: ToolContext,
  ): Promise<ToolResult<SearchPropertiesToolResult>> {
    const conversation = await deps.conversations.getContext(context.conversationId);
    if (isErr(conversation)) {
      return toolError("CONTEXT_UNAVAILABLE", "No pude recuperar la conversación", true);
    }

    const base = toSearchCriteria(conversation.value.profile);
    if (!base) {
      return toolError(
        "MISSING_OPERATION",
        "Todavía no sé si el cliente quiere comprar o arrendar. Pregúntaselo antes de buscar.",
        false,
      );
    }

    // Los argumentos refinan; nunca sustituyen lo que el cliente ya dijo salvo
    // que sean explícitamente más concretos.
    const criteria = {
      ...base,
      ...(args.city ? { city: args.city } : {}),
      ...(args.neighborhoods?.length ? { neighborhoods: args.neighborhoods } : {}),
      ...(args.bedroomsMin !== undefined ? { bedroomsMin: args.bedroomsMin } : {}),
      ...(args.features?.length ? { features: args.features } : {}),
      ...(args.maxPrice !== undefined
        ? { price: { ...base.price, max: args.maxPrice, currency: base.price?.currency ?? "COP" } }
        : {}),
    };

    const found = await deps.catalog.search({
      criteria,
      page: { limit: MAX_PRESENTED + 1 },
      conversationId: context.conversationId,
    });

    if (isErr(found)) {
      return toolError(
        "CATALOG_UNAVAILABLE",
        "El catálogo no respondió. No inventes inmuebles: dilo y ofrece consultarlo.",
        true,
      );
    }

    const all = found.value.items;
    const presented = all.slice(0, MAX_PRESENTED);

    if (presented.length === 0) {
      return toolOk(
        { count: 0, hasMore: false, refs: [], items: [] },
        "Sin resultados para esos criterios",
      );
    }

    // Constancia de lo mostrado ANTES de mostrarlo: si algo falla después,
    // sigue existiendo el registro de lo que el cliente estaba viendo.
    await deps.catalog.recordShown({
      conversationId: context.conversationId,
      contactId: context.contactId,
      properties: presented,
    });

    const cards = presented.map((property) => toPropertyCard(property));
    const hasMore = all.length > presented.length || found.value.nextCursor !== undefined;

    const blocks: ReplyBlock[] = [
      { kind: "property_list", items: cards, ...(hasMore ? { more: true } : {}) },
    ];

    return toolOk(
      {
        count: presented.length,
        hasMore,
        refs: presented.map((property) => property.ref.key),
        // Datos planos para el modelo: es lo único que tiene permitido citar.
        items: presented.map((property) => summarize(property)),
      },
      `${String(presented.length)} inmuebles encontrados`,
      blocks,
    );
  },
});

const summarize = (property: Property): Record<string, unknown> => ({
  ref: property.ref.key,
  title: property.title,
  price: property.price.amount,
  currency: property.price.currency,
  city: property.city,
  neighborhood: property.neighborhood,
  bedrooms: property.bedrooms,
  bathrooms: property.bathrooms,
  areaM2: property.areaM2,
});
