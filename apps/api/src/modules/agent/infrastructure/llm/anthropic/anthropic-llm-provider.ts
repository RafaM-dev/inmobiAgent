import Anthropic from "@anthropic-ai/sdk";
import { UpstreamError, type AppError } from "../../../../../platform/errors/app-error";
import type { Logger } from "../../../../../platform/logging/logger";
import { err, ok, type Result } from "../../../../../platform/result/result";
import type {
  LLMProvider,
  LlmGenerateRequest,
  LlmGenerateResult,
} from "../../../application/ports/llm-provider";
import { estimateCostUsd, hasKnownPrice } from "../pricing";
import {
  toAnthropicMessages,
  toAnthropicTools,
  textFrom,
  toFinishReason,
  toolCallsFrom,
} from "./anthropic.mapper";

/**
 * Modelo por defecto. El más capaz de la familia Opus; se cambia con
 * `ANTHROPIC_MODEL` sin tocar código.
 */
const DEFAULT_MODEL = "claude-opus-5";

/**
 * Suelo de `max_tokens`.
 *
 * En los modelos actuales el razonamiento está ACTIVO por defecto y consume
 * del mismo presupuesto que la respuesta. Un turno que pide 500 tokens —lo
 * normal para dos frases en un chat— se quedaría sin sitio para contestar
 * después de pensar, y el cliente recibiría una frase cortada a la mitad.
 *
 * Se sube el techo en vez de apagar el razonamiento porque apagarlo tiene un
 * fallo mucho peor: el modelo escribe entonces la llamada a la herramienta
 * como TEXTO en su respuesta. El turno termina bien, no hay error, y la
 * herramienta simplemente no se ejecuta nunca — una cita que nadie agenda sin
 * que nada lo señale.
 *
 * Subir el techo no cuesta: se factura lo generado, no lo permitido.
 */
const MIN_OUTPUT_TOKENS = 4096;

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /**
   * Profundidad de razonamiento. `low` por defecto: este agente responde por
   * WhatsApp, donde la latencia se nota, y las decisiones que de verdad
   * importan —intención, escalamiento, fechas, precios— las toman políticas
   * deterministas, no el modelo. Al modelo le toca elegir herramienta y
   * redactar.
   */
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

/**
 * `AnthropicLLMProvider` — adaptador de la Messages API.
 *
 * Tres decisiones que no son obvias:
 *
 * 1. **No se envía `temperature`.** Los modelos actuales de Anthropic la
 *    RECHAZAN con un 400. El puerto la exige porque otros proveedores la
 *    aceptan; aquí se descarta, que es justo lo que el puerto dice que debe
 *    hacer un adaptador con lo que su proveedor no soporta. Se controla el
 *    comportamiento con `effort` y con el prompt.
 *
 * 2. **Un rechazo del clasificador no es una caída.** Llega con HTTP 200 y
 *    `stop_reason: "refusal"`; se traduce a `content_filter`, que el agente ya
 *    sabe manejar. Reintentarlo daría el mismo rechazo.
 *
 * 3. **Se usa el SDK oficial y no `fetch`.** A diferencia del cliente de
 *    WhatsApp —donde el contrato es un puñado de campos estables— aquí el
 *    formato de mensajes, los bloques de contenido y el streaming cambian con
 *    cada modelo. El SDK trae además reintentos con backoff y el manejo de
 *    errores tipado que si no habría que reescribir peor.
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly id = "anthropic";

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<AnthropicProviderOptions["effort"]>;

  constructor(
    private readonly deps: { options: AnthropicProviderOptions; logger: Logger },
  ) {
    this.model = deps.options.model ?? DEFAULT_MODEL;
    this.effort = deps.options.effort ?? "low";

    this.client = new Anthropic({
      apiKey: deps.options.apiKey,
      timeout: deps.options.timeoutMs ?? 60_000,
      maxRetries: deps.options.maxRetries ?? 2,
    });

    if (!hasKnownPrice(this.model)) {
      // El turno funciona igual; solo se pierde la estimación de coste.
      deps.logger.warn("Modelo sin precio conocido: el coste estimado será 0", {
        model: this.model,
      });
    }
  }

  async generate(
    request: LlmGenerateRequest,
  ): Promise<Result<LlmGenerateResult, AppError>> {
    const { system, messages } = toAnthropicMessages(request.messages);

    // La API rechaza una conversación vacía. El contrato del puerto exige que
    // eso viaje como Result, no como excepción.
    if (messages.length === 0) {
      return err(new UpstreamError("anthropic", "invalid_response"));
    }

    const model = request.model ?? this.model;

    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: Math.max(request.maxOutputTokens, MIN_OUTPUT_TOKENS),
          ...(system.length > 0 ? { system } : {}),
          messages,
          ...(request.tools.length > 0 ? { tools: toAnthropicTools(request.tools) } : {}),
          output_config: { effort: this.effort },
        },
        // El aborto del presupuesto por turno del agente llega hasta aquí: sin
        // esto, un turno cancelado seguiría gastando tokens en el proveedor.
        request.abortSignal ? { signal: request.abortSignal } : {},
      );

      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      };

      if (response.stop_reason === "refusal") {
        this.deps.logger.warn("El modelo declinó la petición", {
          model: response.model,
          category: response.stop_details?.category ?? null,
        });
      }

      return ok({
        content: textFrom(response.content),
        toolCalls: toolCallsFrom(response.content),
        finishReason: toFinishReason(response.stop_reason),
        usage: { ...usage, estimatedCostUsd: estimateCostUsd(response.model, usage) },
        model: response.model,
      });
    } catch (error) {
      return err(this.toAppError(error, model));
    }
  }

  /**
   * Todo fallo sale como `UpstreamError`: para el agente, un proveedor que
   * falla es un proveedor que falla, y responde al cliente sin inventarse nada.
   * El detalle técnico se queda en el log, no en el mensaje de WhatsApp.
   */
  private toAppError(error: unknown, model: string): AppError {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      this.deps.logger.error("Anthropic agotó el tiempo de espera", { model });
      return new UpstreamError("anthropic", "timeout", error);
    }

    if (error instanceof Anthropic.APIError) {
      this.deps.logger.error("La API de Anthropic devolvió un error", {
        model,
        status: error.status,
        requestId: error.requestID,
      });

      /*
       * Un 4xx que no sea 429 es culpa NUESTRA —petición mal formada, clave
       * inválida, modelo inexistente— y reintentarlo daría el mismo error. Se
       * distingue del resto para que el bucle del agente no insista.
       */
      const status = typeof error.status === "number" ? error.status : 0;
      const ourFault = status >= 400 && status < 500 && status !== 429;
      return new UpstreamError("anthropic", ourFault ? "invalid_response" : "unavailable", error);
    }

    const message = error instanceof Error ? error.message : String(error);
    this.deps.logger.error("Fallo al llamar a Anthropic", { model, err: message });
    return new UpstreamError("anthropic", "unavailable", error);
  }
}
