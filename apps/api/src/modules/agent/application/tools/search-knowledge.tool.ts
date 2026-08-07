import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import type { ReplyBlock } from "../../../channels";
import type { KnowledgeService } from "../../../knowledge";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../ports/agent-tool";

/** Código que el guardrail de citación reconoce. Es un contrato, no un texto. */
export const NO_ANSWER_CODE = "NO_ANSWER";

export const searchKnowledgeSchema = z.object({
  question: z
    .string()
    .min(3)
    .max(300)
    .describe("La pregunta del cliente, tal cual la hizo"),
  collections: z
    .array(z.string().min(2).max(60))
    .max(3)
    .optional()
    .describe("Colecciones donde buscar. Omítelo para buscar en todas."),
});

export type SearchKnowledgeArgs = z.infer<typeof searchKnowledgeSchema>;

export interface SearchKnowledgeToolResult {
  readonly found: true;
  /** Pasajes LITERALES. Es lo único que el modelo puede parafrasear. */
  readonly passages: readonly { source: string; text: string }[];
  readonly sources: readonly string[];
}

/**
 * `search_knowledge` — responder con lo que dice la inmobiliaria, no con lo que
 * el modelo cree recordar.
 *
 * Dos garantías, y ninguna depende de que el modelo se porte bien:
 *
 * 1. **Sin fuente no hay respuesta.** Si la base de conocimiento no tiene nada
 *    defendible, la herramienta devuelve `NO_ANSWER`. El `CitationGuardrail`
 *    ve ese código y sustituye lo que el modelo hubiera redactado (docs §13:
 *    "sin cita → NO_ANSWER").
 *
 * 2. **Las fuentes las escribe la herramienta.** Viajan como bloques
 *    construidos aquí a partir de los documentos reales, igual que los precios
 *    de una ficha (D16) o la hora de una visita (D20). El modelo no puede
 *    inventarse un "según nuestro reglamento" que no exista.
 */
export const createSearchKnowledgeTool = (deps: {
  knowledge: KnowledgeService;
}): AgentTool<SearchKnowledgeArgs, SearchKnowledgeToolResult> => ({
  name: "search_knowledge",
  description:
    "Consulta la documentación de la inmobiliaria: políticas, requisitos, condiciones de " +
    "arriendo, preguntas frecuentes y trámites. Úsala SIEMPRE que el cliente pregunte algo " +
    "sobre cómo funcionan las cosas. No respondas de memoria: lo que no esté aquí, no lo sabes.",
  parameters: searchKnowledgeSchema,
  sideEffect: "none",

  async execute(
    args: SearchKnowledgeArgs,
    context: ToolContext,
  ): Promise<ToolResult<SearchKnowledgeToolResult>> {
    const found = await deps.knowledge.search({
      question: args.question,
      ...(args.collections?.length ? { collectionSlugs: args.collections } : {}),
    });

    if (isErr(found)) {
      return toolError(
        "KNOWLEDGE_UNAVAILABLE",
        "No pude consultar la documentación. Dilo y ofrece que un asesor lo confirme.",
        true,
      );
    }

    const answer = found.value;

    if (!answer.found || answer.passages.length === 0) {
      context.logger.debug("Sin respuesta en la base de conocimiento", {
        conversationId: context.conversationId,
      });

      return toolError(
        NO_ANSWER_CODE,
        "No hay nada sobre eso en la documentación de la inmobiliaria. NO improvises una " +
          "respuesta: dile al cliente que lo vas a confirmar con un asesor.",
        false,
      );
    }

    // Las fuentes se renderizan desde los documentos, no las escribe el modelo.
    const blocks: ReplyBlock[] = [
      {
        kind: "text",
        text: `Fuente: ${answer.citations.map((citation) => citation.title).join(" · ")}`,
      },
    ];

    return toolOk(
      {
        found: true,
        passages: answer.passages.map((passage) => ({
          source: passage.heading
            ? `${passage.documentTitle} — ${passage.heading}`
            : passage.documentTitle,
          text: passage.content,
        })),
        sources: answer.citations.map((citation) => citation.title),
      },
      `${String(answer.passages.length)} pasajes encontrados`,
      blocks,
    );
  },
});
