import type { z } from "zod";
import type { Logger } from "../../../../platform/logging/logger";
import type { ReplyBlock } from "../../../channels";

/**
 * PUERTO `AgentTool` — lo único que el agente sabe hacer con el mundo.
 *
 * El agente no llama a `PropertyService`, ni a `LeadService`, ni a un CRM:
 * llama a herramientas. Cada herramienta envuelve un puerto de otro módulo y
 * traduce entre "lo que un modelo de lenguaje puede pedir" y "lo que el
 * negocio permite hacer".
 *
 * DEFENSA CONTRA PROMPT INJECTION (docs §8.1, §16): el `tenantId` viaja en el
 * `ToolContext`, JAMÁS en los argumentos. Da igual lo que le digan al modelo en
 * un mensaje o dentro de un documento recuperado: no existe forma de que una
 * herramienta acabe leyendo o escribiendo en otra inmobiliaria, porque el
 * modelo no tiene ese dato entre las manos.
 */

export interface ToolContext {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly correlationId: string;
  readonly logger: Logger;
  /** Corta la ejecución cuando el turno agota su presupuesto de tiempo. */
  readonly abortSignal: AbortSignal;
}

/**
 * Resultado de una herramienta. Es SIEMPRE un dato estructurado, nunca una
 * excepción: un fallo se le devuelve al modelo para que lo explique o lo
 * corrija, y queda auditado igual que un éxito.
 */
export type ToolResult<R> =
  | {
      readonly ok: true;
      readonly data: R;
      readonly summary?: string;
      /**
       * Bloques listos para enviar al cliente, construidos por la herramienta
       * a partir de SUS datos.
       *
       * Es la aplicación literal de la regla anti-alucinación (docs §7.3, paso
       * 5): las fichas de inmueble se renderizan desde la respuesta de la tool,
       * no desde texto redactado por el modelo. El modelo pone la frase que
       * acompaña; los precios, las áreas y las direcciones vienen por aquí.
       */
      readonly blocks?: readonly ReplyBlock[];
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      /** `true` si reintentar con otros argumentos puede funcionar. */
      readonly retriable: boolean;
    };

export const toolOk = <R>(
  data: R,
  summary?: string,
  blocks?: readonly ReplyBlock[],
): ToolResult<R> => ({
  ok: true,
  data,
  ...(summary ? { summary } : {}),
  ...(blocks && blocks.length > 0 ? { blocks } : {}),
});

export const toolError = (code: string, message: string, retriable = false): ToolResult<never> => ({
  ok: false,
  code,
  message,
  retriable,
});

/**
 * `none`  → solo lee; se puede repetir sin consecuencias.
 * `write` → cambia el estado del negocio; debe ser idempotente por turno.
 */
export type ToolSideEffect = "none" | "write";

export interface AgentTool<TArgs = unknown, TResult = unknown> {
  readonly name: string;
  /** Se le envía al modelo tal cual: es su única forma de saber cuándo usarla. */
  readonly description: string;
  /** Zod es la fuente de verdad; el JSON Schema del proveedor se deriva de aquí. */
  readonly parameters: z.ZodType<TArgs>;
  readonly sideEffect: ToolSideEffect;
  execute(args: TArgs, context: ToolContext): Promise<ToolResult<TResult>>;
}

/** Herramienta ya sin parametrizar, tal como la guarda el registro. */
export type AnyAgentTool = AgentTool<never>;
