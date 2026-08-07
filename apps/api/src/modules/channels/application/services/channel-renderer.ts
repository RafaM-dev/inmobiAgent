import type { ChannelCapabilities } from "../../domain/value-objects/channel-capabilities";
import type { PropertyCardData, ReplyBlock } from "../../domain/value-objects/reply-block";

/**
 * Degradación por capacidades (docs §7.4).
 *
 * Función pura: mismas entradas, misma salida, cero dependencias. Es la pieza
 * que permite escribir UNA sola lógica de respuesta y que se vea decente en un
 * canal con botones, en uno de solo texto y en una terminal.
 *
 * Se prueba sola, sin canal, sin base de datos y sin IA.
 */

const formatCard = (card: PropertyCardData, index?: number): string => {
  const heading = index === undefined ? card.title : `${String(index)}. ${card.title}`;
  const lines: string[] = [heading];

  if (card.price) lines.push(card.price);
  if (card.location) lines.push(card.location);
  if (card.attributes?.length) {
    lines.push(card.attributes.map((a) => `${a.label}: ${a.value}`).join(" · "));
  }
  if (card.summary) lines.push(card.summary);
  if (card.url) lines.push(card.url);

  return lines.join("\n");
};

/** Trocea respetando párrafos y, si no queda otra, palabras. */
const splitText = (text: string, maxLength: number): string[] => {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of text.split("\n")) {
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

const asText = (text: string, max: number): ReplyBlock[] =>
  splitText(text, max).map((chunk) => ({ kind: "text", text: chunk }) as const);

export const renderBlocks = (
  blocks: readonly ReplyBlock[],
  capabilities: ChannelCapabilities,
): ReplyBlock[] => {
  const out: ReplyBlock[] = [];
  const max = capabilities.maxTextLength;

  for (const block of blocks) {
    switch (block.kind) {
      case "text":
        out.push(...asText(block.text, max));
        break;

      case "quick_replies":
        if (capabilities.supportsQuickReplies) {
          out.push(block);
        } else {
          // Lista numerada: el usuario responde con el número y el sistema lo
          // interpreta igual que si hubiera pulsado el botón.
          const options = block.options
            .map((o, i) => `${String(i + 1)}. ${o.label}`)
            .join("\n");
          out.push(...asText(`${block.prompt}\n${options}`, max));
        }
        break;

      case "property_card":
        if (capabilities.supportsRichCards) out.push(block);
        else out.push(...asText(formatCard(block.card), max));
        break;

      case "property_list":
        if (capabilities.supportsRichCards) {
          out.push(block);
        } else {
          const parts = [
            ...(block.intro ? [block.intro] : []),
            ...block.items.map((card, i) => formatCard(card, i + 1)),
            ...(block.more ? ["¿Quieres ver más opciones?"] : []),
          ];
          out.push(...asText(parts.join("\n\n"), max));
        }
        break;

      case "media":
        if (capabilities.supportsMedia) out.push(block);
        else out.push(...asText(block.caption ? `${block.caption}\n${block.url}` : block.url, max));
        break;

      case "link":
        if (capabilities.supportsLinkPreview) out.push(block);
        else out.push(...asText(`${block.label}: ${block.url}`, max));
        break;

      case "handoff_notice":
        // Se conserva como bloque propio: un canal puede querer destacarlo y el
        // back-office necesita saber que el bot dejó de responder.
        out.push(block);
        break;
    }
  }

  return out;
};
