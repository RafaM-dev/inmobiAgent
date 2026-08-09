import { describe, expect, it } from "vitest";
import { NoopLogger } from "../../../../../platform/logging/logger";
import { isErr, isOk } from "../../../../../platform/result/result";
import { EMBEDDING_DIMENSIONS } from "../../../application/ports/embedding-provider";
import { OpenAiCompatibleEmbeddingProvider } from "./openai-embedding-provider";

/**
 * Lo que se comprueba aquí es todo lo que puede salir mal SIN que el proveedor
 * dé un error: lotes mal partidos, vectores emparejados con el fragmento
 * equivocado y dimensiones que no caben en la columna. Ninguna de las tres
 * lanza excepción por su cuenta; las tres producen un buscador que responde
 * cosas sin sentido, que es mucho peor que uno que falla.
 *
 * Se inyecta un `fetch` en vez de doblar el SDK: así se ejerce la petición real
 * que se construye —incluido si lleva o no `dimensions`— y no una imitación.
 */

interface Captured {
  readonly model: string;
  readonly input: string[];
  readonly dimensions?: number;
}

const vectorOf = (size: number, fill: number): number[] => new Array<number>(size).fill(fill);

/** `fetch` de mentira que apunta lo que se le pide y responde lo que se le diga. */
const fakeFetch = (
  responder: (body: Captured) => unknown,
  captured: Captured[],
): typeof globalThis.fetch =>
  ((_url: string, init?: RequestInit) => {
    // El SDK siempre serializa el cuerpo antes de llamar: es una cadena.
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as Captured;
    captured.push(body);

    return Promise.resolve(
      new Response(JSON.stringify(responder(body)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof globalThis.fetch;

/** Respuesta bien formada: un vector por entrada, con su índice. */
const okResponse = (body: Captured, size = EMBEDDING_DIMENSIONS) => ({
  object: "list",
  model: body.model,
  data: body.input.map((_text, index) => ({
    object: "embedding",
    index,
    embedding: vectorOf(size, index + 1),
  })),
  usage: { prompt_tokens: 1, total_tokens: 1 },
});

const build = (options: {
  responder: (body: Captured) => unknown;
  captured: Captured[];
  batchSize?: number;
  requestDimensions?: boolean;
}) =>
  new OpenAiCompatibleEmbeddingProvider({
    options: {
      id: "openai",
      apiKey: "clave-de-prueba",
      model: "text-embedding-3-small",
      requestDimensions: options.requestDimensions ?? true,
      batchSize: options.batchSize ?? 96,
      maxRetries: 0,
      fetch: fakeFetch(options.responder, options.captured),
    },
    logger: new NoopLogger(),
  });

describe("Embeddings por API compatible con OpenAI", () => {
  it("vectoriza en lotes del tamaño configurado, no de uno en uno", async () => {
    const captured: Captured[] = [];
    const provider = build({ responder: okResponse, captured, batchSize: 2 });

    const result = await provider.embedDocuments(["a", "b", "c", "d", "e"]);

    expect(isOk(result)).toBe(true);
    expect(captured.map((call) => call.input.length)).toEqual([2, 2, 1]);
  });

  it("devuelve un vector por fragmento y en el mismo orden que entraron", async () => {
    const captured: Captured[] = [];
    const provider = build({ responder: okResponse, captured, batchSize: 2 });

    const result = await provider.embedDocuments(["a", "b", "c"]);

    expect(isOk(result) && result.value).toHaveLength(3);
  });

  it("ordena por el `index` de la respuesta, no por la posición del array", async () => {
    const captured: Captured[] = [];
    // El proveedor contesta el lote AL REVÉS: sin ordenar, cada fragmento se
    // quedaría con el vector de otro y nadie se enteraría.
    const provider = build({
      captured,
      responder: (body) => {
        const good = okResponse(body);
        return { ...good, data: [...good.data].reverse() };
      },
    });

    const result = await provider.embedDocuments(["primero", "segundo"]);

    // `okResponse` rellena cada vector con `index + 1`.
    expect(isOk(result) && result.value[0]?.[0]).toBe(1);
    expect(isOk(result) && result.value[1]?.[0]).toBe(2);
  });

  it("rechaza una dimensión que no cabe en la columna, y explica qué hacer", async () => {
    const captured: Captured[] = [];
    const provider = build({
      captured,
      responder: (body) => okResponse(body, 768),
    });

    const result = await provider.embedDocuments(["hola"]);

    expect(isErr(result)).toBe(true);
    // El mensaje tiene que servir para arreglarlo sin leer el código.
    const message = isErr(result) ? result.error.message : "";
    expect(message).toContain("768");
    expect(message).toContain("1536");
    expect(message).toContain("reindexa");
    // No es un fallo del proveedor: reintentarlo no lo arregla.
    expect(isErr(result) && result.error.operational).toBe(false);
  });

  it("falla si vuelven menos vectores de los pedidos", async () => {
    const captured: Captured[] = [];
    const provider = build({
      captured,
      responder: (body) => {
        const good = okResponse(body);
        return { ...good, data: good.data.slice(0, 1) };
      },
    });

    expect(isErr(await provider.embedDocuments(["a", "b"]))).toBe(true);
  });

  it("pide la dimensión cuando se le dice, y no cuando no", async () => {
    const conDimension: Captured[] = [];
    await build({ responder: okResponse, captured: conDimension }).embedQuery("hola");
    expect(conDimension[0]?.dimensions).toBe(EMBEDDING_DIMENSIONS);

    const sinDimension: Captured[] = [];
    await build({
      responder: okResponse,
      captured: sinDimension,
      requestDimensions: false,
    }).embedQuery("hola");
    expect(sinDimension[0]).not.toHaveProperty("dimensions");
  });

  it("un fragmento vacío no tumba el lote entero", async () => {
    const captured: Captured[] = [];
    const provider = build({ responder: okResponse, captured });

    const result = await provider.embedDocuments(["texto real", "   ", "otro texto"]);

    expect(isOk(result) && result.value).toHaveLength(3);
    // El vacío viaja como un espacio: el proveedor rechazaría la cadena vacía.
    expect(captured[0]?.input[1]).toBe(" ");
  });

  it("una lista vacía no llama al proveedor", async () => {
    const captured: Captured[] = [];
    const provider = build({ responder: okResponse, captured });

    const result = await provider.embedDocuments([]);

    expect(isOk(result) && result.value).toEqual([]);
    expect(captured).toHaveLength(0);
  });

  it("si el proveedor se cae, devuelve error en vez de lanzar", async () => {
    const provider = new OpenAiCompatibleEmbeddingProvider({
      options: {
        id: "openai",
        apiKey: "clave-de-prueba",
        model: "text-embedding-3-small",
        requestDimensions: true,
        batchSize: 96,
        maxRetries: 0,
        fetch: () => Promise.reject(new Error("ECONNREFUSED")),
      },
      logger: new NoopLogger(),
    });

    const result = await provider.embedQuery("hola");

    expect(isErr(result)).toBe(true);
  });
});
