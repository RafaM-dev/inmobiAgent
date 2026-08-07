import { describe, expect, it } from "vitest";
import { isOk } from "../../../platform/result/result";
import type {
  LLMProvider,
  LlmGenerateRequest,
  LlmToolSchema,
} from "../application/ports/llm-provider";

/**
 * SUITE DE CONTRATO del puerto `LLMProvider`.
 *
 * La misma suite corre contra el mock hoy y contra OpenAI, Anthropic y Ollama
 * en F8 (docs §14). Es lo que convierte "cambiar `LLM_PROVIDER` y ya" de
 * promesa en hecho verificable: si un adaptador nuevo pasa esto, el resto del
 * sistema funciona con él.
 *
 * Solo comprueba lo que TODO proveedor debe cumplir. No comprueba redacción:
 * un modelo real dirá cosas distintas cada vez, y eso está bien. Comprueba la
 * forma del contrato, que es lo que el orquestador da por supuesto.
 */

const SAVE_TOOL: LlmToolSchema = {
  name: "save_customer_preferences",
  description: "Guarda lo que el cliente ha dicho que busca.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
      operation: { type: "string", enum: ["SALE", "RENT"] },
    },
  },
};

const HANDOFF_TOOL: LlmToolSchema = {
  name: "request_human_agent",
  description: "Pasa la conversación a un asesor humano.",
  parameters: {
    type: "object",
    properties: { reason: { type: "string" } },
    required: ["reason"],
  },
};

const SYSTEM = [
  "Eres Sofía, asesor inmobiliario de Inmobiliaria Demo.",
  "Tutea. Sé cálido y natural.",
  "",
  "TE FALTA POR SABER (pregúntalo con tus palabras, sin sonar a formulario):",
  "¿Estás buscando para comprar o para arrendar? ¿En qué ciudad la estás buscando?",
].join("\n");

const request = (overrides: Partial<LlmGenerateRequest> = {}): LlmGenerateRequest => ({
  messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: "hola" },
  ],
  tools: [SAVE_TOOL, HANDOFF_TOOL],
  temperature: 0.3,
  maxOutputTokens: 500,
  ...overrides,
});

/**
 * @param name    Nombre del adaptador, para el título de los tests.
 * @param create  Fábrica del proveedor bajo prueba.
 */
export const describeLLMProviderContract = (name: string, create: () => LLMProvider): void => {
  describe(`Contrato LLMProvider — ${name}`, () => {
    it("responde con texto cuando no hace falta ninguna herramienta", async () => {
      const result = await create().generate(request());

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.content.length).toBeGreaterThan(0);
      expect(result.value.toolCalls).toHaveLength(0);
      expect(result.value.finishReason).toBe("stop");
    });

    it("pide herramientas con un id, un nombre válido y argumentos objeto", async () => {
      const result = await create().generate(
        request({
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "busco apartamento en arriendo en Medellín" },
          ],
        }),
      );

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const [call] = result.value.toolCalls;
      expect(call).toBeDefined();
      if (!call) return;

      expect(call.id.length).toBeGreaterThan(0);
      // Nunca puede pedir una herramienta que no se le ofreció.
      expect(["save_customer_preferences", "request_human_agent"]).toContain(call.name);
      expect(typeof call.arguments).toBe("object");
      expect(result.value.finishReason).toBe("tool_calls");
    });

    it("los identificadores de llamada son únicos dentro de una respuesta", async () => {
      const result = await create().generate(
        request({
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "busco casa en venta en Envigado, 3 habitaciones" },
          ],
        }),
      );

      if (!isOk(result)) return;
      const ids = result.value.toolCalls.map((call) => call.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("cierra el turno con texto tras recibir el resultado de una herramienta", async () => {
      const result = await create().generate(
        request({
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "busco apartamento en Medellín" },
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "save_customer_preferences",
                  arguments: { city: "Medellín" },
                },
              ],
            },
            {
              role: "tool",
              toolCallId: "call-1",
              name: "save_customer_preferences",
              content: JSON.stringify({ ok: true, data: { saved: ["city"] } }),
            },
          ],
        }),
      );

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.content.length).toBeGreaterThan(0);
      expect(result.value.finishReason).toBe("stop");
    });

    it("informa siempre del consumo y del modelo que respondió", async () => {
      const result = await create().generate(request());

      if (!isOk(result)) return;
      expect(result.value.model.length).toBeGreaterThan(0);
      expect(result.value.usage.promptTokens).toBeGreaterThan(0);
      expect(result.value.usage.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it("no lanza excepciones: los fallos viajan como Result", async () => {
      // Un turno absurdo (sin mensajes) no puede reventar el proceso.
      const result = await create()
        .generate(request({ messages: [], tools: [] }))
        .catch(() => "lanzó");

      expect(result).not.toBe("lanzó");
    });
  });
};
