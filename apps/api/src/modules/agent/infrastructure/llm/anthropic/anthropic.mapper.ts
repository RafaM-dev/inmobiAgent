import type Anthropic from "@anthropic-ai/sdk";
import type {
  LlmFinishReason,
  LlmMessage,
  LlmToolCall,
  LlmToolSchema,
} from "../../../application/ports/llm-provider";

/**
 * Traducción entre el puerto `LLMProvider` y la Messages API de Anthropic.
 *
 * Funciones PURAS, en un archivo aparte del adaptador, para poder probar la
 * traducción entera sin red ni credenciales. Es donde viven las diferencias
 * reales entre nuestro modelo de conversación y el de Anthropic — y son varias,
 * ninguna cosmética.
 */

/* ========================================================================== *
 * Entrada: nuestros mensajes → Messages API
 * ========================================================================== */

export interface MappedConversation {
  /** El prompt de sistema NO es un mensaje: es un campo de primer nivel. */
  readonly system: string;
  readonly messages: Anthropic.MessageParam[];
}

/**
 * Cuatro diferencias que hay que salvar:
 *
 * 1. **El sistema no es un mensaje.** En Anthropic va en su propio campo. Si
 *    llegan varios, se concatenan en orden.
 * 2. **Un resultado de herramienta lo manda el USUARIO**, como bloque
 *    `tool_result`, no un rol `tool` propio.
 * 3. **Los resultados consecutivos se agrupan en un solo mensaje.** Partirlos
 *    en varios le enseña al modelo a dejar de pedir herramientas en paralelo.
 * 4. **Un turno del asistente sin texto y sin herramientas no existe.** La API
 *    rechaza contenido vacío, así que esos turnos se descartan.
 */
export const toAnthropicMessages = (messages: readonly LlmMessage[]): MappedConversation => {
  const systemParts: string[] = [];
  const mapped: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system": {
        if (message.content.trim().length > 0) systemParts.push(message.content);
        break;
      }

      case "user": {
        mapped.push({ role: "user", content: message.content });
        break;
      }

      case "assistant": {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (message.content.trim().length > 0) {
          blocks.push({ type: "text", text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        // Un turno vacío haría fallar la petición entera.
        if (blocks.length > 0) mapped.push({ role: "assistant", content: blocks });
        break;
      }

      case "tool": {
        const block: Anthropic.ContentBlockParam = {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        };

        // Se agrupa con el mensaje anterior si ya era de resultados.
        const previous = mapped[mapped.length - 1];
        if (previous?.role === "user" && Array.isArray(previous.content)) {
          previous.content.push(block);
        } else {
          mapped.push({ role: "user", content: [block] });
        }
        break;
      }
    }
  }

  return { system: systemParts.join("\n\n"), messages: mapped };
};

/** Nuestro esquema de herramienta → el suyo. Solo cambia el nombre del campo. */
export const toAnthropicTools = (tools: readonly LlmToolSchema[]): Anthropic.Tool[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool["input_schema"],
  }));

/* ========================================================================== *
 * Salida: Messages API → nuestro resultado
 * ========================================================================== */

/**
 * Texto para el cliente.
 *
 * Los bloques `thinking` se ignoran: son razonamiento del modelo, no algo que
 * un cliente de la inmobiliaria deba leer. El agente los descarta aquí, en la
 * frontera, para que ninguna capa de arriba tenga que acordarse.
 */
export const textFrom = (content: readonly Anthropic.ContentBlock[]): string =>
  content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

/**
 * Llamadas a herramientas.
 *
 * `input` llega ya deserializado —a diferencia de otros proveedores, que
 * mandan una cadena JSON— pero se comprueba que sea un objeto: los argumentos
 * del modelo no son datos de confianza, y quien los valida de verdad es el
 * `ToolRegistry` con su esquema Zod.
 */
export const toolCallsFrom = (content: readonly Anthropic.ContentBlock[]): LlmToolCall[] =>
  content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments:
        block.input !== null && typeof block.input === "object" && !Array.isArray(block.input)
          ? (block.input as Record<string, unknown>)
          : {},
    }));

/**
 * `stop_reason` → nuestro `LlmFinishReason`.
 *
 * `refusal` se traduce a `content_filter` y no a un error: que un clasificador
 * de seguridad decline una petición es una respuesta legítima de la API —llega
 * con HTTP 200— y el agente ya sabe qué hacer con `content_filter`. Tratarlo
 * como una caída provocaría reintentos que van a declinarse igual.
 *
 * `pause_turn` se traduce a `tool_calls`: el turno no terminó y hay que
 * reanudarlo, que es exactamente lo que hace el bucle del agente.
 */
export const toFinishReason = (stopReason: string | null): LlmFinishReason => {
  switch (stopReason) {
    case "tool_use":
    case "pause_turn":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "stop";
  }
};
