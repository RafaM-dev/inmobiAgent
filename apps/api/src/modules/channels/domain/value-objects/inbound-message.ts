import type { ChannelType } from "./channel-type";

/**
 * Contenido entrante normalizado.
 *
 * Un audio de WhatsApp, un adjunto de Telegram y una línea escrita en la
 * terminal llegan al núcleo con esta misma forma. `unsupported` existe para no
 * perder el hecho de que el cliente envió *algo*: el agente podrá decir "no
 * puedo escuchar audios todavía" en lugar de ignorarlo.
 */
export type InboundContent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "media";
      readonly url: string;
      readonly mediaType: "image" | "video" | "audio" | "document";
      readonly caption?: string;
    }
  | { readonly kind: "location"; readonly latitude: number; readonly longitude: number }
  | { readonly kind: "unsupported"; readonly description: string };

/**
 * Mensaje entrante canónico. Es la frontera entre "el mundo de fuera" y el
 * núcleo del producto: a partir de aquí no existe el concepto de proveedor.
 */
export interface InboundMessage {
  readonly channelType: ChannelType;
  readonly channelAccountId: string;
  readonly tenantId: string;
  /**
   * Id del mensaje en el proveedor. Es la clave de idempotencia de los
   * webhooks: los proveedores reintentan, y reintentar no puede duplicar
   * conversaciones (docs §16).
   */
  readonly externalMessageId: string;
  /** Id del cliente en el proveedor (teléfono, chat id, sesión del navegador). */
  readonly externalContactId: string;
  readonly contactDisplayName?: string;
  readonly content: readonly InboundContent[];
  readonly receivedAt: Date;
}

/** Texto plano del mensaje: lo que el agente lee. Vacío si no había texto. */
export const inboundText = (message: InboundMessage): string =>
  message.content
    .filter((c): c is Extract<InboundContent, { kind: "text" }> => c.kind === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
