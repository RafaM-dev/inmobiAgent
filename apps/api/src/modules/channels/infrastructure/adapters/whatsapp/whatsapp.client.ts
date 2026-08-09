import { UpstreamError, type AppError } from "../../../../../platform/errors/app-error";
import type { Logger } from "../../../../../platform/logging/logger";
import { err, isErr, ok, okVoid, type Result } from "../../../../../platform/result/result";
import type { WhatsAppOutboundMessage } from "./whatsapp.types";

/**
 * Cliente de la Graph API de Meta.
 *
 * Es un puerto para que el canal se pueda probar sin red: el adaptador de
 * verdad habla HTTP, y los tests le pasan uno que registra lo que se envía. Sin
 * esta separación, probar el canal exigiría un número de WhatsApp real.
 */

export interface SendMessageInput {
  /** Identidad de la cuenta en Meta; va en la ruta de la petición. */
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly message: WhatsAppOutboundMessage;
}

export interface SendMessageOutput {
  /** `wamid.…` con el que llegarán después los acuses de entrega. */
  readonly providerMessageId?: string;
}

export interface VerifyAccountInput {
  readonly phoneNumberId: string;
  readonly accessToken: string;
}

export interface WhatsAppClient {
  send(input: SendMessageInput): Promise<Result<SendMessageOutput, AppError>>;

  /**
   * ¿Este token puede operar este número?
   *
   * Se usa al conectar una línea desde el back-office, para no descubrir un
   * token mal pegado tres días después con un cliente esperando respuesta.
   */
  verify(input: VerifyAccountInput): Promise<Result<void, AppError>>;
}

/**
 * Códigos de error de Meta que merecen un trato propio.
 *
 * `131047` es el que aparece en cuanto el producto sale a producción: han
 * pasado más de 24 horas desde el último mensaje del cliente y ya no se le
 * puede escribir texto libre, solo una plantilla aprobada. Traducirlo a un
 * mensaje entendible es la diferencia entre diagnosticarlo en un minuto o en
 * una tarde.
 */
const RE_ENGAGEMENT_CODE = 131_047;

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface GraphSendResponse {
  messages?: readonly { id?: string }[];
}

export interface GraphWhatsAppClientOptions {
  /** Base de la Graph API. Configurable para poder apuntarla a un doble. */
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly timeoutMs: number;
}

export class GraphWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly deps: {
      options: GraphWhatsAppClientOptions;
      logger: Logger;
    },
  ) {}

  async send(input: SendMessageInput): Promise<Result<SendMessageOutput, AppError>> {
    const response = await this.call(`${this.node(input.phoneNumberId)}/messages`, {
      method: "POST",
      accessToken: input.accessToken,
      body: input.message,
    });
    if (isErr(response)) return response;

    const parsed = response.value as GraphSendResponse | null;
    const providerMessageId = parsed?.messages?.[0]?.id;

    return ok(providerMessageId !== undefined ? { providerMessageId } : {});
  }

  /**
   * LEE el número. No envía nada: verificar mandando un mensaje de prueba
   * gastaría una conversación facturable y le llegaría a alguien.
   *
   * De la respuesta NO se lee un solo campo, solo el código de estado. Es
   * deliberado: el contrato del que dependemos aquí es "una lectura
   * autenticada del nodo responde 2xx, y si no, Meta explica por qué en el
   * sobre de error que ya modelamos". Interpretar campos de un cuerpo que no
   * hemos visto contra una cuenta real sería inventarse la API.
   */
  async verify(input: VerifyAccountInput): Promise<Result<void, AppError>> {
    const response = await this.call(this.node(input.phoneNumberId), {
      method: "GET",
      accessToken: input.accessToken,
    });

    return isErr(response) ? response : okVoid();
  }

  /** `…/{version}/{phone_number_id}`, sin barras duplicadas. */
  private node(phoneNumberId: string): string {
    const { baseUrl, apiVersion } = this.deps.options;
    return `${baseUrl.replace(/\/+$/, "")}/${apiVersion}/${phoneNumberId}`;
  }

  private async call(
    url: string,
    options: { method: "GET" | "POST"; accessToken: string; body?: unknown },
  ): Promise<Result<unknown, AppError>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        // Un proveedor lento no puede dejar colgado el turno de un cliente.
        signal: AbortSignal.timeout(this.deps.options.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      return err(new UpstreamError("whatsapp", timedOut ? "timeout" : "unavailable", cause));
    }

    const body: unknown = await response.json().catch(() => null);

    return response.ok ? ok(body) : err(this.toUpstreamError(response.status, body));
  }

  private toUpstreamError(status: number, body: unknown): AppError {
    const graph = (body as GraphErrorBody | null)?.error;

    this.deps.logger.warn("La Graph API rechazó la petición", {
      status,
      code: graph?.code,
      subcode: graph?.error_subcode,
      // El fbtrace_id es lo que pide Meta para investigar una incidencia.
      fbtrace: graph?.fbtrace_id,
      message: graph?.message,
    });

    if (graph?.code === RE_ENGAGEMENT_CODE) {
      return new UpstreamError("whatsapp", "invalid_response", {
        code: graph.code,
        message:
          "Han pasado más de 24 horas desde el último mensaje del cliente: WhatsApp solo " +
          "permite responder con una plantilla aprobada.",
      });
    }

    // 5xx y 429 son transitorios; 4xx suele ser configuración (token caducado,
    // número no verificado) y no se arregla reintentando.
    const kind = status >= 500 || status === 429 ? "unavailable" : "invalid_response";
    return new UpstreamError("whatsapp", kind, graph ?? { status });
  }
}
