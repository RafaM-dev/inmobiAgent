/**
 * Bloques de respuesta agnósticos de canal (docs §7.4).
 *
 * Este es EL contrato que hace que WhatsApp sea sustituible. El agente produce
 * bloques; el renderer los degrada según las capacidades del canal; el
 * adaptador los serializa. Ni el agente ni ningún caso de uso saben qué aspecto
 * tendrá el mensaje final.
 *
 * Regla anti-alucinación (docs §16): las fichas de inmueble llevan DATOS, no
 * texto redactado por el modelo. El precio que ve el cliente sale siempre de la
 * respuesta de una tool, nunca de una frase generada.
 */

export interface QuickReplyOption {
  readonly label: string;
  /** Valor que se recibirá de vuelta si el usuario lo elige. */
  readonly value: string;
}

/**
 * Datos mínimos de un inmueble para pintarlo. Estructura propia y plana a
 * propósito: `channels` no depende de `catalog`, es `catalog` quien rellena
 * esta forma. Así el contrato de presentación no se ata a ningún proveedor.
 */
export interface PropertyCardData {
  readonly reference: string;
  readonly title: string;
  /** Ya formateado por quien conoce la moneda del tenant. */
  readonly price?: string;
  readonly location?: string;
  readonly summary?: string;
  readonly attributes?: readonly { label: string; value: string }[];
  readonly imageUrl?: string;
  readonly url?: string;
}

export type ReplyBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "property_card"; readonly card: PropertyCardData }
  | {
      readonly kind: "property_list";
      readonly intro?: string;
      readonly items: readonly PropertyCardData[];
      readonly more?: boolean;
    }
  | {
      readonly kind: "quick_replies";
      readonly prompt: string;
      readonly options: readonly QuickReplyOption[];
    }
  | {
      readonly kind: "media";
      readonly url: string;
      readonly mediaType: "image" | "video" | "audio" | "document";
      readonly caption?: string;
    }
  | { readonly kind: "link"; readonly url: string; readonly label: string }
  | { readonly kind: "handoff_notice"; readonly reason: string; readonly message: string };

export type ReplyBlockKind = ReplyBlock["kind"];

/* Constructores: leen mejor en los casos de uso y evitan literales sueltos. */

export const textBlock = (text: string): ReplyBlock => ({ kind: "text", text });

export const quickRepliesBlock = (
  prompt: string,
  options: readonly QuickReplyOption[],
): ReplyBlock => ({ kind: "quick_replies", prompt, options });

export const linkBlock = (url: string, label: string): ReplyBlock => ({ kind: "link", url, label });

export const handoffNoticeBlock = (reason: string, message: string): ReplyBlock => ({
  kind: "handoff_notice",
  reason,
  message,
});
