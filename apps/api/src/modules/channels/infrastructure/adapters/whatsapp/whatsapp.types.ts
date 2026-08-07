/**
 * Formas del payload de WhatsApp Cloud API.
 *
 * ⚠️ TODO lo específico de Meta vive en este archivo y en los dos mapeadores de
 * al lado. Es deliberado: son datos de una API externa que no controlamos y que
 * cambia de versión, así que si algo no coincide con la documentación de Meta,
 * se corrige aquí y NADA más del sistema se entera.
 *
 * Los tipos describen lo que el proveedor *dice* que envía; los mapeadores no
 * se fían y validan campo por campo. Un webhook es entrada no confiable aunque
 * venga firmada.
 */

export interface WhatsAppProfile {
  readonly name?: string;
}

export interface WhatsAppContact {
  readonly profile?: WhatsAppProfile;
  /** Teléfono en formato internacional sin `+`. Es la identidad del cliente. */
  readonly wa_id?: string;
}

export interface WhatsAppTextBody {
  readonly body?: string;
}

/** Respuesta a un botón: `id` es lo que nosotros mandamos; `title`, lo que vio. */
export interface WhatsAppReply {
  readonly id?: string;
  readonly title?: string;
}

export interface WhatsAppInteractive {
  readonly type?: string;
  readonly button_reply?: WhatsAppReply;
  readonly list_reply?: WhatsAppReply;
}

export interface WhatsAppMedia {
  /** Identificador del archivo EN META. Descargarlo exige otra llamada. */
  readonly id?: string;
  readonly mime_type?: string;
  readonly caption?: string;
}

export interface WhatsAppLocation {
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface WhatsAppMessage {
  readonly from?: string;
  /** `wamid.…` — la clave de idempotencia del mensaje entrante. */
  readonly id?: string;
  /** Segundos desde época, como CADENA. */
  readonly timestamp?: string;
  readonly type?: string;
  readonly text?: WhatsAppTextBody;
  readonly interactive?: WhatsAppInteractive;
  readonly image?: WhatsAppMedia;
  readonly audio?: WhatsAppMedia;
  readonly video?: WhatsAppMedia;
  readonly document?: WhatsAppMedia;
  readonly sticker?: WhatsAppMedia;
  readonly location?: WhatsAppLocation;
}

export interface WhatsAppStatusError {
  readonly code?: number;
  readonly title?: string;
  readonly message?: string;
}

export interface WhatsAppStatus {
  /** Id del mensaje que NOSOTROS enviamos. */
  readonly id?: string;
  readonly status?: string;
  readonly timestamp?: string;
  readonly recipient_id?: string;
  readonly errors?: readonly WhatsAppStatusError[];
}

export interface WhatsAppMetadata {
  readonly display_phone_number?: string;
  /** Identidad de la cuenta: es lo que resuelve el tenant. */
  readonly phone_number_id?: string;
}

export interface WhatsAppChangeValue {
  readonly messaging_product?: string;
  readonly metadata?: WhatsAppMetadata;
  readonly contacts?: readonly WhatsAppContact[];
  readonly messages?: readonly WhatsAppMessage[];
  readonly statuses?: readonly WhatsAppStatus[];
}

export interface WhatsAppChange {
  readonly field?: string;
  readonly value?: WhatsAppChangeValue;
}

export interface WhatsAppEntry {
  readonly id?: string;
  readonly changes?: readonly WhatsAppChange[];
}

export interface WhatsAppWebhookPayload {
  readonly object?: string;
  readonly entry?: readonly WhatsAppEntry[];
}

/* -------------------------------------------------------------------------- *
 * Salida
 * -------------------------------------------------------------------------- */

export interface WhatsAppOutboundText {
  readonly messaging_product: "whatsapp";
  readonly recipient_type: "individual";
  readonly to: string;
  readonly type: "text";
  readonly text: { readonly body: string; readonly preview_url: boolean };
}

export interface WhatsAppOutboundInteractive {
  readonly messaging_product: "whatsapp";
  readonly recipient_type: "individual";
  readonly to: string;
  readonly type: "interactive";
  readonly interactive: {
    readonly type: "button";
    readonly body: { readonly text: string };
    readonly action: {
      readonly buttons: readonly {
        readonly type: "reply";
        readonly reply: { readonly id: string; readonly title: string };
      }[];
    };
  };
}

export type WhatsAppOutboundMessage = WhatsAppOutboundText | WhatsAppOutboundInteractive;

/* -------------------------------------------------------------------------- *
 * Límites del proveedor
 *
 * No son preferencias nuestras: son topes de la API. Están aquí, con nombre,
 * porque el mapeador de salida decide en función de ellos si puede usar botones
 * o tiene que degradar a una lista numerada.
 * -------------------------------------------------------------------------- */

export const WHATSAPP_LIMITS = {
  /** Caracteres por mensaje de texto. */
  maxTextLength: 4096,
  /** Botones de respuesta rápida por mensaje interactivo. */
  maxButtons: 3,
  /** Caracteres del rótulo de un botón. */
  maxButtonTitle: 20,
  /** Caracteres del identificador que viaja con el botón. */
  maxButtonId: 256,
  /** Cuerpo de un mensaje interactivo. */
  maxInteractiveBody: 1024,
} as const;
