import {
  defaultCapabilities,
  type ChannelCapabilities,
} from "../../../domain/value-objects/channel-capabilities";
import { WHATSAPP_LIMITS } from "./whatsapp.types";

/**
 * Lo que WhatsApp sabe hacer.
 *
 * `supportsQuickReplies: true` con matiz: el proveedor admite botones, pero
 * solo tres y con rótulos de veinte caracteres. Esa restricción no cabe en la
 * estructura de capacidades —es demasiado específica para un contrato que
 * también describe Telegram o el web chat—, así que la resuelve el mapeador de
 * salida degradando a lista numerada cuando no caben. El agente sigue diciendo
 * "ofrece estas opciones" y no se entera.
 *
 * `supportsMedia: false` es deliberado y honesto: enviar imágenes exige subirlas
 * o exponer URLs públicas, y leer las que manda el cliente exige otra llamada a
 * la Graph API. Nada de eso está en F6, así que decirlo aquí hace que el
 * renderer degrade en vez de que el adaptador falle.
 */
export const whatsAppCapabilities = (): ChannelCapabilities =>
  defaultCapabilities({
    supportsQuickReplies: true,
    supportsRichCards: false,
    supportsMedia: false,
    supportsLinkPreview: true,
    supportsStreaming: false,
    supportsTypingIndicator: false,
    maxTextLength: WHATSAPP_LIMITS.maxTextLength,
    // Cuatro mensajes seguidos ya es mucho en un chat personal; más parece spam
    // y WhatsApp penaliza la calidad del número por ello.
    maxMessagesPerTurn: 4,
  });
