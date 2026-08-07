import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { LlmMessage } from "../../../application/ports/llm-provider";
import {
  toAnthropicMessages,
  toAnthropicTools,
  textFrom,
  toFinishReason,
  toolCallsFrom,
} from "./anthropic.mapper";

/**
 * Estos tests son la razón de que la traducción viva en funciones puras: cubren
 * las diferencias entre nuestro modelo de conversación y el de Anthropic sin
 * red, sin credenciales y sin gastar un céntimo.
 */

describe("toAnthropicMessages", () => {
  it("saca el prompt de sistema de los mensajes y lo pone aparte", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "Eres Sofía." },
      { role: "user", content: "hola" },
    ]);

    // En Anthropic el sistema NO es un mensaje: es un campo de primer nivel.
    expect(system).toBe("Eres Sofía.");
    expect(messages).toEqual([{ role: "user", content: "hola" }]);
  });

  it("concatena varios mensajes de sistema en orden", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "Eres Sofía." },
      { role: "system", content: "Tutea siempre." },
      { role: "user", content: "hola" },
    ]);

    expect(system).toBe("Eres Sofía.\n\nTutea siempre.");
    expect(messages).toHaveLength(1);
  });

  it("convierte el resultado de una herramienta en un bloque del usuario", () => {
    const { messages } = toAnthropicMessages([
      { role: "user", content: "busco apartamento" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "search_properties", arguments: { city: "Medellín" } }],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "search_properties",
        content: '{"ok":true}',
      },
    ]);

    // Anthropic no tiene rol "tool": el resultado lo manda el usuario.
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-1", content: '{"ok":true}' }],
    });
  });

  it("agrupa resultados consecutivos en un solo mensaje", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "busco apartamento" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "search_properties", arguments: {} },
          { id: "call-2", name: "search_knowledge", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "call-1", name: "search_properties", content: "a" },
      { role: "tool", toolCallId: "call-2", name: "search_knowledge", content: "b" },
    ];

    const mapped = toAnthropicMessages(messages).messages;

    /*
     * Un solo mensaje con los dos resultados. Partirlos en dos le enseña al
     * modelo a dejar de pedir herramientas en paralelo — y entonces cada turno
     * pasa a costar el doble de viajes.
     */
    expect(mapped).toHaveLength(3);
    const last = mapped[2];
    expect(Array.isArray(last?.content)).toBe(true);
    expect(last?.content).toHaveLength(2);
  });

  it("descarta un turno del asistente sin texto ni herramientas", () => {
    const { messages } = toAnthropicMessages([
      { role: "user", content: "hola" },
      { role: "assistant", content: "   " },
      { role: "user", content: "¿sigues ahí?" },
    ]);

    // La API rechaza el contenido vacío: enviarlo tumbaría la petición entera.
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.role === "user")).toBe(true);
  });

  it("mantiene juntos el texto y las herramientas del mismo turno", () => {
    const { messages } = toAnthropicMessages([
      { role: "user", content: "busco apartamento en Medellín" },
      {
        role: "assistant",
        content: "Déjame buscar.",
        toolCalls: [{ id: "call-1", name: "search_properties", arguments: { city: "Medellín" } }],
      },
    ]);

    expect(messages[1]?.content).toEqual([
      { type: "text", text: "Déjame buscar." },
      { type: "tool_use", id: "call-1", name: "search_properties", input: { city: "Medellín" } },
    ]);
  });
});

describe("toAnthropicTools", () => {
  it("renombra `parameters` a `input_schema` y conserva el esquema", () => {
    const schema = { type: "object", properties: { city: { type: "string" } } };

    expect(
      toAnthropicTools([{ name: "search", description: "Busca", parameters: schema }]),
    ).toEqual([{ name: "search", description: "Busca", input_schema: schema }]);
  });
});

describe("lectura de la respuesta", () => {
  const textBlock = (text: string): Anthropic.ContentBlock => ({ type: "text", text, citations: [] });

  it("ignora los bloques de razonamiento al componer el texto del cliente", () => {
    const content = [
      { type: "thinking", thinking: "El cliente busca en Medellín…", signature: "x" },
      textBlock("¡Claro! ¿Para comprar o arrendar?"),
    ] as unknown as Anthropic.ContentBlock[];

    // El razonamiento del modelo no es algo que un cliente deba leer.
    expect(textFrom(content)).toBe("¡Claro! ¿Para comprar o arrendar?");
  });

  it("extrae las llamadas a herramientas con sus argumentos", () => {
    const content = [
      { type: "tool_use", id: "toolu_1", name: "search_properties", input: { city: "Envigado" } },
    ] as unknown as Anthropic.ContentBlock[];

    expect(toolCallsFrom(content)).toEqual([
      { id: "toolu_1", name: "search_properties", arguments: { city: "Envigado" } },
    ]);
  });

  it("normaliza a objeto vacío unos argumentos que no son un objeto", () => {
    const content = [
      { type: "tool_use", id: "toolu_1", name: "search_properties", input: "no soy un objeto" },
    ] as unknown as Anthropic.ContentBlock[];

    // Los argumentos del modelo no son datos de confianza; quien los valida de
    // verdad es el ToolRegistry con su esquema Zod.
    expect(toolCallsFrom(content)[0]?.arguments).toEqual({});
  });

  it("traduce cada motivo de parada al del puerto", () => {
    expect(toFinishReason("end_turn")).toBe("stop");
    expect(toFinishReason("tool_use")).toBe("tool_calls");
    expect(toFinishReason("max_tokens")).toBe("length");
    // Un rechazo del clasificador llega con HTTP 200: es una respuesta, no una
    // caída, y reintentarla daría el mismo rechazo.
    expect(toFinishReason("refusal")).toBe("content_filter");
    // El turno no terminó: hay que reanudarlo, que es lo que hace el bucle.
    expect(toFinishReason("pause_turn")).toBe("tool_calls");
    expect(toFinishReason(null)).toBe("stop");
  });
});
