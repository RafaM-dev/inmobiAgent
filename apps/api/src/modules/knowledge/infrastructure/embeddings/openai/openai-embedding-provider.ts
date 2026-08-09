import OpenAI from "openai";
import { InternalError, UpstreamError, type AppError } from "../../../../../platform/errors/app-error";
import type { Logger } from "../../../../../platform/logging/logger";
import { err, isErr, ok, type Result } from "../../../../../platform/result/result";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
} from "../../../application/ports/embedding-provider";

export interface OpenAiCompatibleEmbeddingOptions {
  /** Identificador del adaptador: `openai`, `ollama`… Se persiste con cada fragmento. */
  readonly id: string;
  readonly apiKey: string;
  readonly model: string;
  /** Vacío = la API de OpenAI. Con valor, cualquier servicio compatible. */
  readonly baseUrl?: string;
  /**
   * Pedir explícitamente la dimensión en la petición.
   *
   * Los modelos `text-embedding-3` de OpenAI admiten recortar el vector, lo que
   * permite usar el grande sin cambiar la columna. Otros servicios compatibles
   * no conocen ese parámetro y fallan si se les manda, así que **se decide en
   * el composition root, no aquí**: este adaptador no adivina quién hay
   * detrás de `baseUrl`.
   */
  readonly requestDimensions: boolean;
  /** Entradas por petición. Los proveedores acotan el lote y el número de tokens. */
  readonly batchSize: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /**
   * `fetch` alternativo.
   *
   * Existe para las pruebas —permite comprobar el lote, el orden y la dimensión
   * sin gastar una llamada real— y, de paso, para el día que alguien tenga que
   * salir por un proxy corporativo. Sin esto, lo único comprobable de este
   * adaptador sería que compila.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Embeddings por la API de OpenAI, y por cualquiera que hable su formato.
 *
 * Mismo criterio que el adaptador de chat (D51): `baseUrl` e `id` por
 * configuración en vez de una clase por proveedor. Ollama, vLLM o Together
 * exponen este mismo endpoint; un servicio compatible más es una variable de
 * entorno, no código.
 *
 * Tres cosas que este adaptador NO hace, y las tres a propósito:
 *
 * 1. **No rellena ni recorta vectores.** Si el modelo devuelve 768 dimensiones
 *    y la columna espera 1536, falla con un mensaje que dice qué pasa y qué
 *    hacer. Rellenar con ceros produciría un buscador que responde y miente.
 * 2. **No se fía del orden del array.** La respuesta trae un `index` por
 *    entrada; se ordena por él. Si un día el proveedor devuelve el lote
 *    desordenado, cada fragmento tendría el vector de otro — un fallo que no
 *    da error, solo malas respuestas.
 * 3. **No cachea.** Vectorizar dos veces el mismo texto es tan raro (los
 *    documentos se indexan una vez) que una caché sería complejidad muerta.
 */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private readonly client: OpenAI;

  constructor(
    private readonly deps: { options: OpenAiCompatibleEmbeddingOptions; logger: Logger },
  ) {
    this.id = deps.options.id;
    this.model = deps.options.model;

    this.client = new OpenAI({
      apiKey: deps.options.apiKey,
      ...(deps.options.baseUrl ? { baseURL: deps.options.baseUrl } : {}),
      timeout: deps.options.timeoutMs ?? 30_000,
      maxRetries: deps.options.maxRetries ?? 2,
      ...(deps.options.fetch ? { fetch: deps.options.fetch } : {}),
    });
  }

  async embedDocuments(
    texts: readonly string[],
  ): Promise<Result<readonly number[][], AppError>> {
    if (texts.length === 0) return ok([]);

    const vectors: number[][] = [];

    // En lotes: una petición por fragmento sería lenta y cara, y una sola con
    // mil fragmentos la rechaza el proveedor.
    for (let from = 0; from < texts.length; from += this.deps.options.batchSize) {
      const batch = texts.slice(from, from + this.deps.options.batchSize);
      const embedded = await this.embed(batch);
      if (isErr(embedded)) return embedded;
      vectors.push(...embedded.value);
    }

    return ok(vectors);
  }

  async embedQuery(text: string): Promise<Result<readonly number[], AppError>> {
    const embedded = await this.embed([text]);
    if (isErr(embedded)) return embedded;

    const vector = embedded.value[0];
    if (vector === undefined) {
      return err(new UpstreamError(this.id, "invalid_response"));
    }

    return ok(vector);
  }

  private async embed(texts: readonly string[]): Promise<Result<number[][], AppError>> {
    /*
     * Un texto vacío no se puede vectorizar y los proveedores lo rechazan con
     * un error del lote entero. Se sustituye por un espacio: se prefiere un
     * vector sin significado para ESE fragmento a perder los otros noventa y
     * nueve de la misma petición.
     */
    const input = texts.map((text) => (text.trim().length > 0 ? text : " "));

    let response: Awaited<ReturnType<OpenAI["embeddings"]["create"]>>;
    try {
      response = await this.client.embeddings.create({
        model: this.deps.options.model,
        input: [...input],
        /*
         * `float` EXPLÍCITO, y esto no es cosmético.
         *
         * Si no se dice nada, el SDK pide los vectores en base64 y los
         * descodifica él. Contra OpenAI funciona; contra un servicio
         * compatible que no implemente ese formato —Ollama, vLLM— la respuesta
         * llegaría en floats y el SDK la interpretaría como base64. El
         * resultado serían vectores basura SIN ningún error: un buscador que
         * responde con total seguridad y se equivoca siempre.
         *
         * Se descubrió instrumentando la petición real en las pruebas.
         */
        encoding_format: "float",
        ...(this.deps.options.requestDimensions ? { dimensions: this.dimensions } : {}),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "APIConnectionTimeoutError";
      this.deps.logger.warn("El proveedor de embeddings falló", {
        provider: this.id,
        model: this.deps.options.model,
        batch: texts.length,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return err(new UpstreamError(this.id, timedOut ? "timeout" : "unavailable", cause));
    }

    if (response.data.length !== input.length) {
      this.deps.logger.error("El proveedor devolvió menos vectores de los pedidos", {
        provider: this.id,
        pedidos: input.length,
        recibidos: response.data.length,
      });
      return err(new UpstreamError(this.id, "invalid_response"));
    }

    // Por `index`, no por posición: ver la nota 2 de la cabecera.
    const ordered = [...response.data].sort((a, b) => a.index - b.index);

    for (const item of ordered) {
      if (item.embedding.length !== this.dimensions) {
        this.deps.logger.error("Dimensión de embedding incompatible con la columna", {
          provider: this.id,
          model: this.deps.options.model,
          devueltas: item.embedding.length,
          esperadas: this.dimensions,
        });
        /*
         * `InternalError` y no `UpstreamError`: el proveedor no ha fallado,
         * ha hecho exactamente lo que se le pidió. Es una configuración
         * incorrecta, no se arregla reintentando, y por eso el mensaje va en
         * el error —donde se lee— y no escondido en la causa.
         */
        return err(
          new InternalError(
            `El modelo de embeddings "${this.deps.options.model}" devuelve vectores de ` +
              `${String(item.embedding.length)} dimensiones y la columna espera ` +
              `${String(this.dimensions)}. Elige un modelo de ${String(this.dimensions)} ` +
              "dimensiones o crea una migración que cambie el tipo de la columna y " +
              "reindexa todos los documentos.",
          ),
        );
      }
    }

    return ok(ordered.map((item) => item.embedding));
  }
}
