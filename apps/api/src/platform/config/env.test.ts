import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig } from "./env";

const VALID_KEY = Buffer.alloc(32, 1).toString("base64");
const baseEnv = {
  DATABASE_URL: "postgresql://u:p@localhost:5433/db",
  ENCRYPTION_KEY: VALID_KEY,
};

describe("loadConfig", () => {
  it("arranca en modo demo sin ninguna API key (requisito de producto)", () => {
    const config = loadConfig({ ...baseEnv });

    expect(config.providers.llm).toBe("mock");
    expect(config.providers.embedding).toBe("mock");
    expect(config.providers.property).toBe("mock");
    expect(config.providers.credentials.openaiApiKey).toBeUndefined();
  });

  it("exige la credencial correspondiente al elegir un proveedor real", () => {
    expect(() => loadConfig({ ...baseEnv, LLM_PROVIDER: "openai" })).toThrow(ConfigurationError);

    const config = loadConfig({ ...baseEnv, LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
    expect(config.providers.llm).toBe("openai");
  });

  it("rechaza una clave de cifrado que no sea de 32 bytes", () => {
    expect(() => loadConfig({ ...baseEnv, ENCRYPTION_KEY: "corta" })).toThrow(ConfigurationError);
  });

  it("rechaza configuración de debounce incoherente", () => {
    expect(() =>
      loadConfig({ ...baseEnv, AGENT_TURN_DEBOUNCE_MS: "5000", AGENT_TURN_DEBOUNCE_MAX_MS: "1000" }),
    ).toThrow(ConfigurationError);
  });

  it("no arranca sin DATABASE_URL en vez de fallar más tarde", () => {
    expect(() => loadConfig({ ENCRYPTION_KEY: VALID_KEY })).toThrow(ConfigurationError);
  });

  it("normaliza la lista de orígenes CORS", () => {
    const config = loadConfig({
      ...baseEnv,
      CORS_ORIGINS: "http://a.com, http://b.com ,",
    });
    expect(config.http.corsOrigins).toEqual(["http://a.com", "http://b.com"]);
  });
});
