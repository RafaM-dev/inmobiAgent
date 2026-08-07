import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";

/**
 * PUERTO `LLMProvider` — el principio 4 hecho código.
 *
 * Ningún caso de uso, ninguna política y ninguna entidad conoce OpenAI,
 * Anthropic, Gemini ni Ollama. Conocen esta interfaz. Cambiar de proveedor es
 * cambiar `LLM_PROVIDER` en el entorno; el resto del sistema no se entera.
 *
 * Está modelada sobre el mínimo común denominador de los proveedores actuales
 * —mensajes con roles, llamadas a herramientas, uso de tokens— y no sobre las
 * peculiaridades de ninguno. Si mañana un proveedor añade algo exótico, se
 * traduce en su adaptador o no se usa: el precio de no atarse.
 *
 * Streaming: no está aquí todavía a propósito. Llegará en F7, junto al primer
 * canal que pueda aprovecharlo (el web chat). WhatsApp no hace nada con un
 * flujo token a token, y añadir un método que nadie implementa solo serviría
 * para que los adaptadores mientan.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

/** Petición de herramienta que hace el modelo. */
export interface LlmToolCall {
  /** Identificador de esta llamada concreta; se usa para casar el resultado. */
  readonly id: string;
  readonly name: string;
  /** Argumentos SIN validar: el modelo puede inventarse cualquier cosa. */
  readonly arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls?: readonly LlmToolCall[];
    }
  | {
      readonly role: "tool";
      /** Debe corresponder con el `id` de la llamada que lo originó. */
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
    };

/**
 * Descripción de una herramienta para el modelo.
 * `parameters` es JSON Schema porque es lo que aceptan todos los proveedores;
 * lo genera el `ToolRegistry` a partir del esquema Zod, nunca se escribe a mano.
 */
export interface LlmToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface LlmGenerateRequest {
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolSchema[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** Modelo concreto. `undefined` = el que el adaptador tenga por defecto. */
  readonly model?: string;
  readonly abortSignal?: AbortSignal;
}

export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Coste estimado en USD. `0` en modo demo, y eso es parte de la gracia. */
  readonly estimatedCostUsd: number;
}

export type LlmFinishReason = "stop" | "tool_calls" | "length" | "content_filter";

export interface LlmGenerateResult {
  /** Texto para el usuario. Vacío cuando el modelo solo pide herramientas. */
  readonly content: string;
  readonly toolCalls: readonly LlmToolCall[];
  readonly finishReason: LlmFinishReason;
  readonly usage: LlmUsage;
  /** Modelo que respondió de verdad. Se persiste en el AgentRun. */
  readonly model: string;
}

export interface LLMProvider {
  /** Identificador del adaptador: `mock`, `openai`, `anthropic`… */
  readonly id: string;

  /**
   * Devuelve `Result` y no lanza: que un proveedor esté caído, tarde de más o
   * responda algo ininteligible es parte de la operación normal de este
   * producto. El agente lo traduce a lenguaje natural sin inventar datos.
   */
  generate(request: LlmGenerateRequest): Promise<Result<LlmGenerateResult, AppError>>;
}

/**
 * Contador de tokens. Vive en el kernel (`platform/text`) porque `knowledge`
 * necesita el MISMO estimador para trocear documentos: un fragmento "de 500
 * tokens" tiene que medir lo mismo al indexarlo que al mandarlo al modelo.
 *
 * Sigue siendo un puerto porque cada proveedor tokeniza distinto: en F8 cada
 * adaptador traerá el suyo y el `ContextBuilder` recortará la ventana con
 * precisión real en vez de con una estimación.
 */
export {
  HeuristicTokenCounter,
  type TokenCounter,
} from "../../../../platform/text/token-counter";
