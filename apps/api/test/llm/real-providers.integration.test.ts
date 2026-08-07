import { describe, it } from "vitest";
import { describeLLMProviderContract } from "../../src/modules/agent/testing/llm-provider.contract";
import { AnthropicLLMProvider } from "../../src/modules/agent/infrastructure/llm/anthropic/anthropic-llm-provider";
import { OpenAiCompatibleLLMProvider } from "../../src/modules/agent/infrastructure/llm/openai/openai-llm-provider";
import { NoopLogger } from "../../src/platform/logging/logger";

/**
 * LA MISMA SUITE DE CONTRATO, CONTRA LOS PROVEEDORES DE VERDAD.
 *
 * Es lo que convierte "cambia `LLM_PROVIDER` y ya" de promesa en hecho
 * comprobable. `MockLLMProvider` pasa esta suite en los tests unitarios; aquí
 * la pasan —o no— OpenAI, Anthropic y Ollama, con la red de por medio.
 *
 * **Cada ejecución cuesta dinero de verdad y depende de un servicio ajeno.**
 * Por eso cada proveedor se salta solo si no encuentra su credencial, en vez
 * de fallar: quien clona el repositorio no debe ver tests rojos por no tener
 * una clave de pago, y CI no debe gastar en cada commit.
 *
 * Para ejecutarlos:
 *   ANTHROPIC_API_KEY=sk-ant-…  pnpm test:integration
 *   OPENAI_API_KEY=sk-…  OPENAI_MODEL=…  pnpm test:integration
 *   OLLAMA_CONTRACT=1  pnpm test:integration      (con Ollama corriendo)
 *
 * Un fallo aquí es información valiosa aunque sea intermitente: significa que
 * ese proveedor NO cumple lo que el orquestador da por supuesto, y que
 * cambiarle el `LLM_PROVIDER` a una inmobiliaria rompería algo.
 */

const logger = new NoopLogger();

const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const openaiKey = process.env["OPENAI_API_KEY"];
const openaiModel = process.env["OPENAI_MODEL"];
const ollamaEnabled = process.env["OLLAMA_CONTRACT"] === "1";

if (anthropicKey) {
  describeLLMProviderContract(
    "anthropic",
    () =>
      new AnthropicLLMProvider({
        options: {
          apiKey: anthropicKey,
          ...(process.env["ANTHROPIC_MODEL"]
            ? { model: process.env["ANTHROPIC_MODEL"] }
            : {}),
          effort: "low",
        },
        logger,
      }),
  );
} else {
  describe.skip("Contrato LLMProvider — anthropic", () => {
    it("necesita ANTHROPIC_API_KEY", () => undefined);
  });
}

if (openaiKey && openaiModel) {
  describeLLMProviderContract(
    "openai",
    () =>
      new OpenAiCompatibleLLMProvider({
        options: { id: "openai", apiKey: openaiKey, model: openaiModel },
        logger,
      }),
  );
} else {
  describe.skip("Contrato LLMProvider — openai", () => {
    it("necesita OPENAI_API_KEY y OPENAI_MODEL", () => undefined);
  });
}

if (ollamaEnabled) {
  const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

  describeLLMProviderContract(
    "ollama",
    () =>
      new OpenAiCompatibleLLMProvider({
        options: {
          id: "ollama",
          apiKey: "ollama-no-necesita-clave",
          model: process.env["OLLAMA_MODEL"] ?? "llama3.1",
          baseUrl: `${baseUrl.replace(/\/+$/, "")}/v1`,
          // Un modelo local en CPU tarda mucho más que una API.
          timeoutMs: 180_000,
        },
        logger,
      }),
  );
} else {
  describe.skip("Contrato LLMProvider — ollama", () => {
    it("necesita OLLAMA_CONTRACT=1 y Ollama corriendo", () => undefined);
  });
}
