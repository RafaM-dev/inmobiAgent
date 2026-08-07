import type { ChannelAccountView } from "../../../application/ports/chat-channel";
import {
  DeliveryStatus,
  type DeliveryStatusUpdate,
} from "../../../application/ports/chat-channel";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import type { InboundContent, InboundMessage } from "../../../domain/value-objects/inbound-message";
import type {
  WhatsAppChangeValue,
  WhatsAppMessage,
  WhatsAppStatus,
  WhatsAppWebhookPayload,
} from "./whatsapp.types";

/**
 * Payload de Meta → mensajes canónicos.
 *
 * Función pura y desconfiada: un webhook es entrada externa aunque venga
 * firmada, así que aquí no se da por bueno ni un campo. Lo que no se entiende
 * se descarta o se marca como no soportado, nunca se inventa.
 *
 * A partir de la salida de este archivo, nadie en el sistema vuelve a saber que
 * WhatsApp existe.
 */

const MEDIA_LABELS: Record<string, string> = {
  image: "imagen",
  audio: "nota de voz",
  video: "video",
  document: "documento",
  sticker: "sticker",
};

/** Segundos como cadena → `Date`. Si no es utilizable, el reloj del sistema. */
const toDate = (timestamp: string | undefined, fallback: Date): Date => {
  if (timestamp === undefined) return fallback;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;

  return new Date(seconds * 1000);
};

const trimmed = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean.length > 0 ? clean : undefined;
};

/**
 * Contenido de un mensaje según su tipo.
 *
 * Solo `text` y las respuestas a botones se entienden del todo. El resto se
 * marca como no soportado con una descripción legible: es más honesto que
 * fingir que se leyó una imagen, y el agente puede decirle al cliente que por
 * ahora solo lee texto.
 *
 * Descargar media exigiría una segunda llamada a la Graph API para convertir el
 * `id` en una URL temporal. Queda fuera de F6 a propósito: media a medias es
 * peor que sin media.
 */
const toContent = (message: WhatsAppMessage): InboundContent[] => {
  const type = message.type ?? "unknown";

  if (type === "text") {
    const body = trimmed(message.text?.body);
    return body ? [{ kind: "text", text: body }] : [];
  }

  if (type === "interactive") {
    // El cliente pulsó un botón. Se toma el RÓTULO, que es lo que él vio y lo
    // que tiene sentido en el historial de la conversación.
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    const title = trimmed(reply?.title) ?? trimmed(reply?.id);
    return title ? [{ kind: "text", text: title }] : [];
  }

  if (type === "location") {
    const { latitude, longitude } = message.location ?? {};
    if (typeof latitude === "number" && typeof longitude === "number") {
      return [{ kind: "location", latitude, longitude }];
    }
    return [{ kind: "unsupported", description: "ubicación ilegible" }];
  }

  const label = MEDIA_LABELS[type];
  if (label) {
    const media = message.image ?? message.audio ?? message.video ?? message.document;
    const caption = trimmed(media?.caption);

    // El pie de foto SÍ es texto que el cliente escribió: se conserva.
    return caption
      ? [
          { kind: "text", text: caption },
          { kind: "unsupported", description: `${label} adjunta` },
        ]
      : [{ kind: "unsupported", description: `${label} recibida` }];
  }

  return [{ kind: "unsupported", description: `mensaje de tipo ${type}` }];
};

/**
 * Parte el payload por número de teléfono.
 *
 * Meta entrega TODOS los webhooks de la app a una sola URL, así que una misma
 * llamada puede traer mensajes de dos inmobiliarias distintas. Sin esta
 * separación, al resolver la cuenta de la primera se le entregarían también los
 * mensajes de la segunda: una fuga de datos entre clientes por descuido de
 * estructura, no de permisos.
 *
 * Cada trozo conserva la forma del payload original para que el resto del
 * adaptador no tenga que saber que hubo un reparto.
 */
export const splitByPhoneNumber = (
  payload: WhatsAppWebhookPayload,
): { phoneNumberId: string; payload: WhatsAppWebhookPayload }[] => {
  const byPhone = new Map<string, WhatsAppChangeValue[]>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = trimmed(change.value?.metadata?.phone_number_id);
      if (!phoneNumberId || !change.value) continue;

      const bucket = byPhone.get(phoneNumberId) ?? [];
      bucket.push(change.value);
      byPhone.set(phoneNumberId, bucket);
    }
  }

  return [...byPhone.entries()].map(([phoneNumberId, values]) => ({
    phoneNumberId,
    payload: {
      ...(payload.object !== undefined ? { object: payload.object } : {}),
      entry: [{ changes: values.map((value) => ({ field: "messages", value })) }],
    },
  }));
};

/** Recorre el payload y devuelve todos los mensajes que trae, en orden. */
export const toInboundMessages = (
  payload: WhatsAppWebhookPayload,
  account: ChannelAccountView,
  now: Date,
): InboundMessage[] => {
  const messages: InboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Nombres de perfil, indexados por teléfono: vienen en un array aparte.
      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        const waId = trimmed(contact.wa_id);
        const name = trimmed(contact.profile?.name);
        if (waId && name) names.set(waId, name);
      }

      for (const message of value.messages ?? []) {
        const externalMessageId = trimmed(message.id);
        const from = trimmed(message.from);
        // Sin id no hay idempotencia y sin remitente no hay conversación: un
        // mensaje así no es procesable, y descartarlo es lo correcto.
        if (!externalMessageId || !from) continue;

        const content = toContent(message);
        if (content.length === 0) continue;

        const displayName = names.get(from);

        messages.push({
          channelType: ChannelType.WHATSAPP,
          channelAccountId: account.id,
          tenantId: account.tenantId,
          externalMessageId,
          externalContactId: from,
          ...(displayName ? { contactDisplayName: displayName } : {}),
          content,
          receivedAt: toDate(message.timestamp, now),
        });
      }
    }
  }

  return messages;
};

const STATUS_MAP: Record<string, DeliveryStatus> = {
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  read: DeliveryStatus.READ,
  failed: DeliveryStatus.FAILED,
};

/** Acuses de entrega del mismo payload. Vienen mezclados con los mensajes. */
export const toDeliveryStatuses = (
  payload: WhatsAppWebhookPayload,
  now: Date,
): DeliveryStatusUpdate[] => {
  const updates: DeliveryStatusUpdate[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        const update = toStatusUpdate(status, now);
        if (update) updates.push(update);
      }
    }
  }

  return updates;
};

const toStatusUpdate = (
  status: WhatsAppStatus,
  now: Date,
): DeliveryStatusUpdate | null => {
  const providerMessageId = trimmed(status.id);
  const mapped = STATUS_MAP[trimmed(status.status)?.toLowerCase() ?? ""];
  if (!providerMessageId || !mapped) return null;

  const reason = status.errors?.[0]
    ? trimmed(status.errors[0].title) ?? trimmed(status.errors[0].message)
    : undefined;

  return {
    providerMessageId,
    status: mapped,
    occurredAt: toDate(status.timestamp, now),
    ...(reason ? { reason } : {}),
  };
};
