import { describe, expect, it } from "vitest";
import { isOk } from "../../../../../platform/result/result";
import { HeuristicTokenCounter, type LlmGenerateRequest } from "../../../application/ports/llm-provider";
import { describeLLMProviderContract } from "../../../testing/llm-provider.contract";
import { MockLLMProvider } from "./mock-llm-provider";

const create = (): MockLLMProvider => new MockLLMProvider({ tokens: new HeuristicTokenCounter() });

// El mock cumple el mismo contrato que cumplirán OpenAI, Anthropic y Ollama.
describeLLMProviderContract("MockLLMProvider", create);

const SYSTEM = [
  "Eres Sofía, asesor inmobiliario de Inmobiliaria Demo.",
  "",
  "TE FALTA POR SABER (pregúntalo con tus palabras, sin sonar a formulario):",
  "¿Estás buscando para comprar o para arrendar? ¿En qué ciudad la estás buscando?",
].join("\n");

const ask = (text: string, system = SYSTEM): LlmGenerateRequest => ({
  messages: [
    { role: "system", content: system },
    { role: "user", content: text },
  ],
  tools: [
    { name: "save_customer_preferences", description: "", parameters: {} },
    { name: "request_human_agent", description: "", parameters: {} },
  ],
  temperature: 0.3,
  maxOutputTokens: 500,
});

describe("MockLLMProvider — comportamiento del modo demo", () => {
  it("se presenta con el nombre y la inmobiliaria que dice el prompt", async () => {
    const result = await create().generate(ask("hola"));

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.content).toContain("Sofía");
    expect(result.value.content).toContain("Inmobiliaria Demo");
  });

  it("hace las preguntas que decidió la política, no las que se le ocurran", async () => {
    const result = await create().generate(ask("hola"));

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.content).toContain("comprar o para arrendar");
    expect(result.value.content).toContain("qué ciudad");
  });

  it("llama a la herramienta de preferencias con lo que entendió del mensaje", async () => {
    const result = await create().generate(ask("busco apto en arriendo en Medellín, 2 habitaciones"));

    if (!isOk(result)) throw new Error("debería responder");
    const [call] = result.value.toolCalls;
    expect(call?.name).toBe("save_customer_preferences");
    expect(call?.arguments).toMatchObject({
      operation: "RENT",
      city: "Medellín",
      propertyType: ["APARTMENT"],
      bedrooms: 2,
    });
  });

  it("pide un humano en cuanto el cliente lo pide, sin insistir", async () => {
    const result = await create().generate(ask("prefiero hablar con una persona"));

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.toolCalls[0]?.name).toBe("request_human_agent");
    expect(result.value.toolCalls[0]?.arguments).toMatchObject({ reason: "USER_REQUEST" });
  });

  it("deriva los temas fuera de alcance en vez de improvisar", async () => {
    const result = await create().generate(ask("necesito un abogado para la escritura"));

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.toolCalls[0]?.arguments).toMatchObject({ reason: "OUT_OF_SCOPE" });
  });

  it("ante una herramienta que falla, no inventa: pide ayuda humana", async () => {
    const result = await create().generate({
      ...ask("¿cuánto cuesta?"),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: "¿cuánto cuesta?" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "x", arguments: {} }] },
        {
          role: "tool",
          toolCallId: "c1",
          name: "x",
          content: JSON.stringify({ ok: false, code: "UPSTREAM_TIMEOUT" }),
        },
      ],
    });

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.content).toContain("asesor");
    expect(result.value.content).not.toMatch(/\$|millones/);
  });

  it("cuando ya no falta nada, deja de preguntar", async () => {
    const complete = "Eres Sofía, asesor inmobiliario de Inmobiliaria Demo.";
    const result = await create().generate({
      ...ask("listo", complete),
      messages: [
        { role: "system", content: complete },
        { role: "user", content: "busco apartamento" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "save", arguments: {} }] },
        {
          role: "tool",
          toolCallId: "c1",
          name: "save_customer_preferences",
          content: JSON.stringify({ ok: true }),
        },
      ],
    });

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.content).toContain("opciones");
  });

  it("es determinista: dos veces el mismo turno, la misma respuesta", async () => {
    const provider = create();
    const first = await provider.generate(ask("busco casa en Envigado"));
    const second = await create().generate(ask("busco casa en Envigado"));

    if (!isOk(first) || !isOk(second)) throw new Error("debería responder");
    expect(first.value.toolCalls[0]?.arguments).toEqual(second.value.toolCalls[0]?.arguments);
    expect(first.value.content).toBe(second.value.content);
  });

  it("no cuesta nada: es el requisito del modo demo", async () => {
    const result = await create().generate(ask("hola"));

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.usage.estimatedCostUsd).toBe(0);
  });

  it("nunca pide una herramienta que no se le ofreció", async () => {
    const result = await create().generate({ ...ask("busco apartamento"), tools: [] });

    if (!isOk(result)) throw new Error("debería responder");
    expect(result.value.toolCalls).toHaveLength(0);
  });
});
