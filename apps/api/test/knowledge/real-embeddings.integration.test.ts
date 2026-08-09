import { describe, it } from "vitest";
import { OpenAiCompatibleEmbeddingProvider } from "../../src/modules/knowledge/infrastructure/embeddings/openai/openai-embedding-provider";
import { describeEmbeddingProviderContract } from "../../src/modules/knowledge/testing/embedding-provider.contract";
import { NoopLogger } from "../../src/platform/logging/logger";

/**
 * EL MISMO CONTRATO DE EMBEDDINGS, CONTRA LOS PROVEEDORES DE VERDAD.
 *
 * Hermano de `test/llm/real-providers.integration.test.ts` y por el mismo
 * motivo: el simulador pasa la suite en los tests unitarios; aquí la pasan —o
 * no— OpenAI y Ollama, con la red de por medio.
 *
 * Aquí sí se exige la parte semántica (`semantic: true`), que es justo lo que
 * se está pagando: encontrar «se permiten mascotas» cuando el cliente escribe
 * «¿puedo llevar mi perro?». Si un proveedor no lo cumple, la búsqueda
 * vectorial no aporta nada sobre el full-text que ya funciona sin él.
 *
 * **Cada ejecución cuesta dinero y depende de un servicio ajeno**, así que cada
 * proveedor se salta solo si no encuentra su credencial: quien clona el
 * repositorio no debe ver rojos por no tener una clave de pago.
 *
 * Para ejecutarlos:
 *   OPENAI_API_KEY=sk-…  pnpm test:integration
 *   OLLAMA_EMBEDDING_CONTRACT=1  pnpm test:integration   (con Ollama corriendo)
 *
 * Ojo con Ollama: la columna es `vector(1536)` y muchos modelos locales de
 * embeddings producen 768. El adaptador lo detecta y lo dice; si pasa, hace
 * falta un modelo de 1536 o una migración de la columna.
 */

const logger = new NoopLogger();

const openaiKey = process.env["OPENAI_API_KEY"];
const ollamaEnabled = process.env["OLLAMA_EMBEDDING_CONTRACT"] === "1";

if (openaiKey) {
  describeEmbeddingProviderContract(
    "openai",
    () =>
      new OpenAiCompatibleEmbeddingProvider({
        options: {
          id: "openai",
          apiKey: openaiKey,
          model: process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small",
          requestDimensions: true,
          batchSize: 96,
        },
        logger,
      }),
    { semantic: true },
  );
} else {
  describe.skip("Contrato de EmbeddingProvider — openai", () => {
    it("necesita OPENAI_API_KEY", () => undefined);
  });
}

if (ollamaEnabled) {
  const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

  describeEmbeddingProviderContract(
    "ollama",
    () =>
      new OpenAiCompatibleEmbeddingProvider({
        options: {
          id: "ollama",
          apiKey: "ollama-no-necesita-clave",
          model: process.env["OLLAMA_EMBEDDING_MODEL"] ?? "nomic-embed-text",
          baseUrl: `${baseUrl.replace(/\/+$/, "")}/v1`,
          // `dimensions` es un parámetro de OpenAI: un compatible puede
          // rechazarlo, así que no se envía y se valida lo que devuelva.
          requestDimensions: false,
          batchSize: 32,
          // Un modelo local en CPU tarda mucho más que una API.
          timeoutMs: 180_000,
        },
        logger,
      }),
    { semantic: true },
  );
} else {
  describe.skip("Contrato de EmbeddingProvider — ollama", () => {
    it("necesita OLLAMA_EMBEDDING_CONTRACT=1 y Ollama corriendo", () => undefined);
  });
}
