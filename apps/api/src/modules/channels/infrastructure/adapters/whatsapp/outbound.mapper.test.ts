import { describe, expect, it } from "vitest";
import type { ReplyBlock } from "../../../domain/value-objects/reply-block";
import { toWhatsAppMessages } from "./outbound.mapper";
import { WHATSAPP_LIMITS } from "./whatsapp.types";

const TO = "573001114444";

describe("Bloques canónicos → mensajes de WhatsApp", () => {
  it("un texto se envía como un mensaje de texto", () => {
    const [message] = toWhatsAppMessages([{ kind: "text", text: "Hola, ¿en qué te ayudo?" }], TO);

    expect(message).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TO,
      type: "text",
      text: { body: "Hola, ¿en qué te ayudo?", preview_url: true },
    });
  });

  it("tres opciones cortas se envían como botones nativos", () => {
    const block: ReplyBlock = {
      kind: "quick_replies",
      prompt: "¿Qué necesitas?",
      options: [
        { label: "Comprar", value: "SALE" },
        { label: "Arrendar", value: "RENT" },
      ],
    };

    const [message] = toWhatsAppMessages([block], TO);

    expect(message?.type).toBe("interactive");
    if (message?.type !== "interactive") throw new Error("debería ser interactivo");

    expect(message.interactive.body.text).toBe("¿Qué necesitas?");
    expect(message.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "SALE", title: "Comprar" } },
      { type: "reply", reply: { id: "RENT", title: "Arrendar" } },
    ]);
  });

  it("el botón lleva el VALOR opaco, no el rótulo", () => {
    // Es lo que permite que al pulsar recibamos la referencia exacta de franja.
    const block: ReplyBlock = {
      kind: "quick_replies",
      prompt: "Elige",
      options: [{ label: "Mañana 9 a. m.", value: "eyJzIjoiMjAyNi0wOC0wN1QxNDowMCJ9" }],
    };

    const [message] = toWhatsAppMessages([block], TO);
    if (message?.type !== "interactive") throw new Error("debería ser interactivo");

    expect(message.interactive.action.buttons[0]?.reply.id).toBe(
      "eyJzIjoiMjAyNi0wOC0wN1QxNDowMCJ9",
    );
  });

  it("más de tres opciones se degradan a lista numerada", () => {
    const block: ReplyBlock = {
      kind: "quick_replies",
      prompt: "¿Cuál prefieres?",
      options: [
        { label: "Una", value: "1" },
        { label: "Dos", value: "2" },
        { label: "Tres", value: "3" },
        { label: "Cuatro", value: "4" },
      ],
    };

    const [message] = toWhatsAppMessages([block], TO);

    expect(message?.type).toBe("text");
    if (message?.type !== "text") throw new Error("debería ser texto");
    expect(message.text.body).toBe("¿Cuál prefieres?\n1. Una\n2. Dos\n3. Tres\n4. Cuatro");
  });

  it("un rótulo demasiado largo degrada en vez de truncarse", () => {
    // Truncar dejaría "viernes, 7 de agost…" y "viernes, 7 de agost…" para dos
    // horas distintas: el cliente elegiría a ciegas.
    const block: ReplyBlock = {
      kind: "quick_replies",
      prompt: "¿Cuál de estos horarios te queda mejor?",
      options: [
        { label: "viernes, 7 de agosto, 9:00 a. m.", value: "a" },
        { label: "viernes, 7 de agosto, 10:00 a. m.", value: "b" },
      ],
    };

    const [message] = toWhatsAppMessages([block], TO);

    expect(message?.type).toBe("text");
    if (message?.type !== "text") throw new Error("debería ser texto");
    expect(message.text.body).toContain("1. viernes, 7 de agosto, 9:00 a. m.");
    expect(message.text.body).toContain("2. viernes, 7 de agosto, 10:00 a. m.");
  });

  it("un rótulo justo en el límite sí cabe como botón", () => {
    const label = "x".repeat(WHATSAPP_LIMITS.maxButtonTitle);
    const block: ReplyBlock = {
      kind: "quick_replies",
      prompt: "Elige",
      options: [{ label, value: "v" }],
    };

    expect(toWhatsAppMessages([block], TO)[0]?.type).toBe("interactive");
  });

  it("un texto larguísimo se trocea respetando el tope del proveedor", () => {
    const parrafo = `${"palabra ".repeat(900)}fin.`;

    const messages = toWhatsAppMessages([{ kind: "text", text: parrafo }], TO);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      if (message.type !== "text") throw new Error("debería ser texto");
      expect(message.text.body.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.maxTextLength);
    }
  });

  it("una ficha de inmueble se envía como texto estructurado", () => {
    const block: ReplyBlock = {
      kind: "property_list",
      intro: "Encontré 2 opciones:",
      items: [
        {
          reference: "mock:apa-1",
          title: "Apartamento en Laureles",
          price: "$1.200.000/mes",
          location: "Laureles, Medellín",
          attributes: [{ label: "Habitaciones", value: "2" }],
        },
        { reference: "mock:apa-2", title: "Apartamento en Envigado", price: "$1.500.000/mes" },
      ],
    };

    const [message] = toWhatsAppMessages([block], TO);
    if (message?.type !== "text") throw new Error("debería ser texto");

    expect(message.text.body).toContain("Encontré 2 opciones:");
    expect(message.text.body).toContain("1. Apartamento en Laureles");
    expect(message.text.body).toContain("$1.200.000/mes");
    expect(message.text.body).toContain("2. Apartamento en Envigado");
  });

  it("varios bloques producen varios mensajes, en orden", () => {
    const messages = toWhatsAppMessages(
      [
        { kind: "text", text: "Estos son los horarios:" },
        {
          kind: "quick_replies",
          prompt: "Elige uno",
          options: [{ label: "Hoy", value: "hoy" }],
        },
      ],
      TO,
    );

    expect(messages.map((m) => m.type)).toEqual(["text", "interactive"]);
  });

  it("un bloque de texto vacío no genera un mensaje vacío", () => {
    expect(toWhatsAppMessages([{ kind: "text", text: "   " }], TO)).toHaveLength(0);
  });

  it("el aviso de traspaso a un humano se envía como texto", () => {
    const [message] = toWhatsAppMessages(
      [{ kind: "handoff_notice", reason: "USER_REQUEST", message: "Te paso con un asesor." }],
      TO,
    );

    if (message?.type !== "text") throw new Error("debería ser texto");
    expect(message.text.body).toBe("Te paso con un asesor.");
  });
});
