import type { InboundContent } from "./inbound-message";
import type { ReplyBlock } from "./reply-block";

/**
 * Proyección a texto plano de lo que se dijo en un mensaje.
 *
 * Vive en `channels` —junto a los contratos que traduce— y no en `conversation`
 * porque la usan dos sitios que no deben divergir: el historial que persiste una
 * conversación y la ventana de contexto que lee el agente. Dos versiones de
 * esto significarían que el modelo ve una conversación distinta de la que
 * guardamos.
 *
 * DEBE incluir lo que el cliente VIO, no solo lo que se escribió como texto: si
 * las opciones que se le ofrecieron desaparecen de aquí, en el turno siguiente
 * el agente no entiende "la segunda".
 *
 * Los precios de las fichas quedan fuera a propósito. El guardrail de grounding
 * compara las cifras de dinero de una respuesta contra lo que devolvieron las
 * herramientas de ESE turno; un precio arrastrado del historial sería
 * indistinguible de uno inventado.
 */
export const blocksToText = (blocks: readonly (InboundContent | ReplyBlock)[]): string =>
  blocks
    .map((block) => {
      switch (block.kind) {
        case "text":
          return block.text;
        case "media":
          return block.caption ?? `[${block.mediaType}]`;
        case "link":
          return `${block.label}: ${block.url}`;
        case "handoff_notice":
          return block.message;
        case "quick_replies":
          return [
            block.prompt,
            ...block.options.map((option, index) => `${String(index + 1)}. ${option.label}`),
          ].join("\n");
        case "property_card":
          return block.card.title;
        case "property_list":
          return [
            ...(block.intro !== undefined ? [block.intro] : []),
            ...block.items.map((card, index) => `${String(index + 1)}. ${card.title}`),
          ].join("\n");
        case "location":
          // Entre corchetes a propósito: es una anotación del sistema sobre lo
          // que llegó, no algo que el cliente haya escrito. Sin ella, un
          // mensaje que solo trae una ubicación produce un turno vacío y el
          // agente responde a la nada.
          return "[ubicación compartida]";
        case "unsupported":
          return `[${block.description}]`;
        default:
          return "";
      }
    })
    .filter((text) => text.length > 0)
    .join("\n");
