import OpenAI from "openai";
import { UpstreamError, type AppError } from "../../../../../platform/errors/app-error";
import type { Logger } from "../../../../../platform/logging/logger";
import { err, ok, type Result } from "../../../../../platform/result/result";
import type {
  LLMProvider,
  LlmGenerateRequest,
  LlmGenerateResult,
} from "../../../application/ports/llm-provider";
import { estimateCostUsd } from "../pricing";
import { toFinishReason, toOpenAiMessages, toOpenAiTools, toolCallsFrom } from "./openai.mapper";

export interface OpenAiCompatibleOptions {
  /** Identificador del adaptador: `openai`, `ollama`… */
  readonly id: string;
  readonly apiKey: string;
  readonly model: string;
  /** Vacío = la API de OpenAI. Con valor, cualquier servicio compatible. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

/**
 * Adaptador de la API de Chat Completions.
 *
 * Sirve para **OpenAI y para cualquier servicio que hable su formato** —Ollama,
 * Groq, Together, vLLM— porque ese formato se convirtió en el estándar de
 * facto. Por eso la clase recibe `baseUrl` e `id` en vez de dar por hecho que
 * al otro lado está OpenAI: un servicio compatible más es una configuración,
 * no una clase nueva.
 *
 * Dos diferencias de fondo con Anthropic, ninguna cosmética:
 *
 * 1. **`temperature` sí se envía.** Aquí se acepta y cambia el resultado. Que
 *    el puerto la exija y un adaptador la use mientras otro la descarta es
 *    exactamente para lo que existe la capa de adaptadores.
 *
 * 2. **Los argumentos de las herramientas llegan como cadena JSON**, y pueden
 *    llegar rotos. El mapeador los deserializa a prueba de fallos.
 */
export class OpenAiCompatibleLLMProvider implements LLMProvider {
  readonly id: string;

  private readonly client: OpenAI;

  constructor(private readonly deps: { options: OpenAiCompatibleOptions; logger: Logger }) {
    this.id = deps.options.id;

    this.client = new OpenAI({
      apiKey: deps.options.apiKey,
      ...(deps.options.baseUrl ? { baseURL: deps.options.baseUrl } : {}),
      timeout: deps.options.timeoutMs ?? 60_000,
      maxRetries: deps.options.maxRetries ?? 2,
    });
  }

  async generate(request: LlmGenerateRequest): Promise<Result<LlmGenerateResult, AppError>> {
    const messages = toOpenAiMessages(request.messages);

    if (messages.length === 0) {
      return err(new UpstreamError(this.id, "invalid_response"));
    }

    const model = request.model ?? this.deps.options.model;

    try {
      const response = await this.client.chat.completions.create(
        {
          model,
          messages,
          temperature: request.temperature,
          max_completion_tokens: request.maxOutputTokens,
          ...(request.tools.length > 0 ? { tools: toOpenAiTools(request.tools) } : {}),
        },
        request.abortSignal ? { signal: request.abortSignal } : {},
      );

      const choice = response.choices[0];
      if (!choice) {
        // Una respuesta sin ninguna opción es una respuesta ininteligible.
        this.deps.logger.error("El proveedor devolvió una respuesta sin contenido", { model });
        return err(new UpstreamError(this.id, "invalid_response"));
      }

      /*
       * Algunos servicios compatibles no rellenan `usage`. Se informa de cero
       * en vez de inventar una cifra: un coste falso es peor que ninguno.
       */
      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      };

      const answeredBy = response.model || model;

      return ok({
        content: choice.message.content ?? "",
        toolCalls: toolCallsFrom(choice.message.tool_calls),
        finishReason: toFinishReason(choice.finish_reason),
        usage: { ...usage, estimatedCostUsd: estimateCostUsd(answeredBy, usage) },
        model: answeredBy,
      });
    } catch (error) {
      return err(this.toAppError(error, model));
    }
  }

  private toAppError(error: unknown, model: string): AppError {
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      this.deps.logger.error("El proveedor agotó el tiempo de espera", { provider: this.id, model });
      return new UpstreamError(this.id, "timeout", error);
    }

    if (error instanceof OpenAI.APIError) {
      this.deps.logger.error("El proveedor devolvió un error", {
        provider: this.id,
        model,
        status: error.status,
        requestId: error.requestID,
      });

      // Un 4xx que no sea 429 es culpa nuestra: reintentarlo daría lo mismo.
      const status = typeof error.status === "number" ? error.status : 0;
      const ourFault = status >= 400 && status < 500 && status !== 429;
      return new UpstreamError(this.id, ourFault ? "invalid_response" : "unavailable", error);
    }

    const message = error instanceof Error ? error.message : String(error);
    this.deps.logger.error("Fallo al llamar al proveedor", { provider: this.id, model, err: message });
    return new UpstreamError(this.id, "unavailable", error);
  }
}
