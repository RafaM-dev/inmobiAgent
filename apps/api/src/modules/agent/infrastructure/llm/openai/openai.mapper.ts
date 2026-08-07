import type OpenAI from "openai";
import type {
  LlmFinishReason,
  LlmMessage,
  LlmToolCall,
  LlmToolSchema,
} from "../../../application/ports/llm-provider";

/**
 * Traducción entre el puerto `LLMProvider` y la Chat Completions API.
 *
 * Funciones puras, en un archivo aparte, por la misma razón que en Anthropic:
 * la traducción se prueba entera sin red ni credenciales.
 *
 * Este formato es además el que hablan Ollama, Groq, Together y casi todo lo
 * compatible, así que este mapeador sirve para más de un adaptador. Es una
 * ventaja real, no una coincidencia: se convirtió en el formato de facto.
 */

/**
 * Aquí el prompt de sistema SÍ es un mensaje —al contrario que en Anthropic— y
 * los resultados de herramienta tienen su propio rol. La conversión es casi
 * directa; la única diferencia de fondo está en la salida.
 */
export const toOpenAiMessages = (
  messages: readonly LlmMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] =>
  messages.map((message): OpenAI.Chat.ChatCompletionMessageParam => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };

      case "user":
        return { role: "user", content: message.content };

      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  // Los argumentos viajan como CADENA JSON, no como objeto.
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }
            : {}),
        };

      case "tool":
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
  });

/** Cada herramienta va envuelta en `{type:"function", function:{…}}`. */
export const toOpenAiTools = (
  tools: readonly LlmToolSchema[],
): OpenAI.Chat.ChatCompletionTool[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

/**
 * Llamadas a herramientas.
 *
 * **Los argumentos llegan como cadena y hay que deserializarlos.** Un modelo
 * puede devolver JSON roto —truncado por el límite de tokens, con una coma de
 * más— y eso no puede tumbar el turno: se traduce a un objeto vacío y el
 * `ToolRegistry` rechazará la llamada con su esquema Zod, que es quien sabe
 * qué argumentos son válidos.
 */
export const toolCallsFrom = (
  toolCalls: readonly OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined,
): LlmToolCall[] => {
  if (!toolCalls) return [];

  return toolCalls
    .filter(
      (call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
        call.type === "function",
    )
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));
};

const parseArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** `finish_reason` → nuestro `LlmFinishReason`. */
export const toFinishReason = (reason: string | null | undefined): LlmFinishReason => {
  switch (reason) {
    // `function_call` es el nombre antiguo; servicios compatibles lo usan aún.
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
};
