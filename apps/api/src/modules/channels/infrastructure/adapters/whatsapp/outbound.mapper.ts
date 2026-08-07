import type { ReplyBlock } from "../../../domain/value-objects/reply-block";
import {
  WHATSAPP_LIMITS,
  type WhatsAppOutboundMessage,
} from "./whatsapp.types";

/**
 * Bloques canónicos → mensajes de WhatsApp.
 *
 * Función pura. Aquí se resuelve el choque entre lo que el producto quiere
 * decir y lo que el proveedor permite:
 *
 * - **Botones**: como máximo tres, y con rótulos de veinte caracteres. Nuestras
 *   franjas de visita ("viernes, 7 de agosto, 9:00 a. m.") no caben, así que
 *   cuando no caben se degradan a lista numerada EN TEXTO. Truncar el rótulo
 *   sería peor: dos franjas del mismo día quedarían con el mismo texto y el
 *   cliente elegiría a ciegas.
 * - **Longitud**: se trocea por párrafo antes que por carácter.
 *
 * Que la degradación viva aquí y no en el agente es justamente el principio 2:
 * el agente dice "ofrece estas tres opciones" y cada canal se las arregla.
 */

const chunkText = (text: string, maxLength: number): string[] => {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxLength) return [clean];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of clean.split("\n")) {
    const candidate = current.length === 0 ? paragraph : `${current}\n${paragraph}`;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }

    let rest = paragraph;
    while (rest.length > maxLength) {
      const cut = rest.lastIndexOf(" ", maxLength);
      const at = cut > maxLength * 0.6 ? cut : maxLength;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    current = rest;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
};

const textMessage = (to: string, body: string): WhatsAppOutboundMessage => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: { body, preview_url: true },
});

/** ¿Caben estas opciones como botones nativos? */
const fitsAsButtons = (
  prompt: string,
  options: readonly { label: string; value: string }[],
): boolean =>
  options.length > 0 &&
  options.length <= WHATSAPP_LIMITS.maxButtons &&
  prompt.length <= WHATSAPP_LIMITS.maxInteractiveBody &&
  options.every(
    (option) =>
      option.label.trim().length > 0 &&
      option.label.length <= WHATSAPP_LIMITS.maxButtonTitle &&
      option.value.length <= WHATSAPP_LIMITS.maxButtonId,
  );

const buttonsMessage = (
  to: string,
  prompt: string,
  options: readonly { label: string; value: string }[],
): WhatsAppOutboundMessage => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: prompt },
    action: {
      buttons: options.map((option) => ({
        type: "reply",
        // El `id` es lo que nos devuelve el proveedor al pulsar: viaja el valor
        // opaco (la referencia de franja), no el rótulo.
        reply: { id: option.value, title: option.label },
      })),
    },
  },
});

/** Lista numerada: la degradación cuando los botones no dan de sí. */
const numbered = (
  prompt: string,
  options: readonly { label: string }[],
): string =>
  [prompt, ...options.map((option, index) => `${String(index + 1)}. ${option.label}`)].join("\n");

export const toWhatsAppMessages = (
  blocks: readonly ReplyBlock[],
  to: string,
): WhatsAppOutboundMessage[] => {
  const messages: WhatsAppOutboundMessage[] = [];

  const pushText = (body: string): void => {
    for (const chunk of chunkText(body, WHATSAPP_LIMITS.maxTextLength)) {
      messages.push(textMessage(to, chunk));
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        pushText(block.text);
        break;

      case "quick_replies":
        if (fitsAsButtons(block.prompt, block.options)) {
          messages.push(buttonsMessage(to, block.prompt, block.options));
        } else {
          pushText(numbered(block.prompt, block.options));
        }
        break;

      case "link":
        pushText(`${block.label}: ${block.url}`);
        break;

      case "handoff_notice":
        pushText(block.message);
        break;

      case "media":
        // Enviar media exige subirla o exponer una URL pública, y descargar la
        // que manda el cliente exige otra llamada a la Graph API. Queda fuera
        // de F6: se manda el enlace, que funciona hoy y no promete nada falso.
        pushText(block.caption ? `${block.caption}\n${block.url}` : block.url);
        break;

      case "property_card":
        pushText(cardToText(block.card));
        break;

      case "property_list":
        pushText(
          [
            ...(block.intro !== undefined ? [block.intro] : []),
            ...block.items.map((card, index) => cardToText(card, index + 1)),
          ].join("\n\n"),
        );
        break;
    }
  }

  return messages;
};

const cardToText = (
  card: {
    title: string;
    price?: string;
    location?: string;
    summary?: string;
    attributes?: readonly { label: string; value: string }[];
    url?: string;
  },
  position?: number,
): string => {
  const lines: string[] = [position === undefined ? card.title : `${String(position)}. ${card.title}`];

  if (card.price) lines.push(card.price);
  if (card.location) lines.push(card.location);
  if (card.attributes?.length) {
    lines.push(card.attributes.map((a) => `${a.label}: ${a.value}`).join(" · "));
  }
  if (card.summary) lines.push(card.summary);
  if (card.url) lines.push(card.url);

  return lines.join("\n");
};
