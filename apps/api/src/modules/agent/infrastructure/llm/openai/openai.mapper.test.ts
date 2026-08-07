import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { toFinishReason, toOpenAiMessages, toOpenAiTools, toolCallsFrom } from "./openai.mapper";

describe("toOpenAiMessages", () => {
  it("deja el prompt de sistema como un mensaje más", () => {
    const messages = toOpenAiMessages([
      { role: "system", content: "Eres Sofía." },
      { role: "user", content: "hola" },
    ]);

    // Al contrario que en Anthropic, aquí el sistema SÍ es un mensaje.
    expect(messages).toEqual([
      { role: "system", content: "Eres Sofía." },
      { role: "user", content: "hola" },
    ]);
  });

  it("serializa los argumentos de la herramienta como cadena JSON", () => {
    const messages = toOpenAiMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "search", arguments: { city: "Medellín" } }],
      },
    ]);

    const assistant = messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
    const call = assistant.tool_calls?.[0];
    expect(call?.type).toBe("function");
    // Cadena, no objeto: es la diferencia con Anthropic que más despista.
    expect(call?.type === "function" ? call.function.arguments : "").toBe('{"city":"Medellín"}');
  });

  it("conserva el rol `tool` con su identificador de llamada", () => {
    const messages = toOpenAiMessages([
      { role: "tool", toolCallId: "call-1", name: "search", content: '{"ok":true}' },
    ]);

    expect(messages).toEqual([
      { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' },
    ]);
  });
});

describe("toOpenAiTools", () => {
  it("envuelve cada herramienta en la forma `function`", () => {
    const parameters = { type: "object", properties: {} };

    expect(toOpenAiTools([{ name: "search", description: "Busca", parameters }])).toEqual([
      { type: "function", function: { name: "search", description: "Busca", parameters } },
    ]);
  });
});

describe("toolCallsFrom", () => {
  const call = (args: string): OpenAI.Chat.ChatCompletionMessageToolCall => ({
    id: "call-1",
    type: "function",
    function: { name: "search", arguments: args },
  });

  it("deserializa los argumentos", () => {
    expect(toolCallsFrom([call('{"city":"Envigado"}')])).toEqual([
      { id: "call-1", name: "search", arguments: { city: "Envigado" } },
    ]);
  });

  it("no revienta con JSON roto: devuelve argumentos vacíos", () => {
    /*
     * Pasa de verdad: el modelo se queda sin tokens a mitad del objeto y manda
     * JSON truncado. Si esto lanzara, un turno se caería por culpa de un
     * argumento mal formado en vez de rechazar solo esa llamada — que es lo
     * que hace el ToolRegistry con su esquema Zod.
     */
    expect(toolCallsFrom([call('{"city":"Env')])).toEqual([
      { id: "call-1", name: "search", arguments: {} },
    ]);
  });

  it("normaliza a objeto vacío lo que no sea un objeto", () => {
    expect(toolCallsFrom([call('"solo una cadena"')])[0]?.arguments).toEqual({});
    expect(toolCallsFrom([call("[1,2,3]")])[0]?.arguments).toEqual({});
  });

  it("sin llamadas devuelve una lista vacía", () => {
    expect(toolCallsFrom(undefined)).toEqual([]);
  });
});

describe("toFinishReason", () => {
  it("traduce los motivos de parada, incluido el nombre antiguo", () => {
    expect(toFinishReason("stop")).toBe("stop");
    expect(toFinishReason("tool_calls")).toBe("tool_calls");
    // Servicios compatibles más antiguos siguen usando este.
    expect(toFinishReason("function_call")).toBe("tool_calls");
    expect(toFinishReason("length")).toBe("length");
    expect(toFinishReason("content_filter")).toBe("content_filter");
    expect(toFinishReason(null)).toBe("stop");
  });
});
