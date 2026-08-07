import { describe, expect, it } from "vitest";
import type { ChannelAccountView } from "../../../application/ports/chat-channel";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import { toDeliveryStatuses, toInboundMessages } from "./inbound.mapper";
import type { WhatsAppWebhookPayload } from "./whatsapp.types";

const NOW = new Date("2026-08-06T15:00:00Z");

const ACCOUNT: ChannelAccountView = {
  id: "acc-1",
  tenantId: "tenant-1",
  channelType: ChannelType.WHATSAPP,
  externalId: "1234567890",
  displayName: "Inmobiliaria Demo",
  config: {},
};

/** Envoltorio del webhook, para no repetir cuatro niveles en cada caso. */
const payload = (value: Record<string, unknown>): WhatsAppWebhookPayload => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA-1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "573001112233", phone_number_id: "1234567890" },
            ...value,
          },
        },
      ],
    },
  ],
});

const textMessage = (overrides: Record<string, unknown> = {}) =>
  payload({
    contacts: [{ profile: { name: "Ana Restrepo" }, wa_id: "573001114444" }],
    messages: [
      {
        from: "573001114444",
        id: "wamid.HBgMNTczMDAx",
        timestamp: "1786028400",
        type: "text",
        text: { body: "  Hola, busco apartamento en Medellín  " },
        ...overrides,
      },
    ],
  });

describe("Payload de WhatsApp → mensajes canónicos", () => {
  it("traduce un mensaje de texto con su remitente y su nombre", () => {
    const [message] = toInboundMessages(textMessage(), ACCOUNT, NOW);

    expect(message?.channelType).toBe(ChannelType.WHATSAPP);
    expect(message?.channelAccountId).toBe("acc-1");
    expect(message?.tenantId).toBe("tenant-1");
    expect(message?.externalMessageId).toBe("wamid.HBgMNTczMDAx");
    expect(message?.externalContactId).toBe("573001114444");
    expect(message?.contactDisplayName).toBe("Ana Restrepo");
    expect(message?.content).toEqual([
      { kind: "text", text: "Hola, busco apartamento en Medellín" },
    ]);
  });

  it("usa la hora del proveedor, no la nuestra", () => {
    const [message] = toInboundMessages(textMessage(), ACCOUNT, NOW);

    // 1786028400 segundos desde época = 2026-08-06T15:00:00Z.
    expect(message?.receivedAt.toISOString()).toBe("2026-08-06T15:00:00.000Z");
  });

  it("si la marca de tiempo no sirve, usa el reloj del sistema", () => {
    const [message] = toInboundMessages(
      textMessage({ timestamp: "no-es-un-numero" }),
      ACCOUNT,
      NOW,
    );

    expect(message?.receivedAt).toEqual(NOW);
  });

  it("devuelve TODOS los mensajes del lote, en orden", () => {
    const lote = payload({
      contacts: [
        { profile: { name: "Ana" }, wa_id: "573001114444" },
        { profile: { name: "Luis" }, wa_id: "573001115555" },
      ],
      messages: [
        { from: "573001114444", id: "wamid.1", timestamp: "1786028400", type: "text", text: { body: "uno" } },
        { from: "573001115555", id: "wamid.2", timestamp: "1786028401", type: "text", text: { body: "dos" } },
        { from: "573001114444", id: "wamid.3", timestamp: "1786028402", type: "text", text: { body: "tres" } },
      ],
    });

    const messages = toInboundMessages(lote, ACCOUNT, NOW);

    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.externalMessageId)).toEqual(["wamid.1", "wamid.2", "wamid.3"]);
    // Cada mensaje lleva el nombre de SU remitente, no el del primero.
    expect(messages[1]?.contactDisplayName).toBe("Luis");
  });

  it("una respuesta a botón se lee como lo que el cliente vio", () => {
    const pulsado = payload({
      messages: [
        {
          from: "573001114444",
          id: "wamid.btn",
          timestamp: "1786028400",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "opcion-2", title: "viernes 10:00 a. m." },
          },
        },
      ],
    });

    const [message] = toInboundMessages(pulsado, ACCOUNT, NOW);

    expect(message?.content).toEqual([{ kind: "text", text: "viernes 10:00 a. m." }]);
  });

  it("una imagen con pie conserva el texto del cliente y marca el adjunto", () => {
    const conFoto = payload({
      messages: [
        {
          from: "573001114444",
          id: "wamid.img",
          timestamp: "1786028400",
          type: "image",
          image: { id: "media-1", mime_type: "image/jpeg", caption: "¿este es el edificio?" },
        },
      ],
    });

    const [message] = toInboundMessages(conFoto, ACCOUNT, NOW);

    expect(message?.content).toEqual([
      { kind: "text", text: "¿este es el edificio?" },
      { kind: "unsupported", description: "imagen adjunta" },
    ]);
  });

  it("una nota de voz se marca como no soportada en vez de fingir que se leyó", () => {
    const audio = payload({
      messages: [
        {
          from: "573001114444",
          id: "wamid.aud",
          timestamp: "1786028400",
          type: "audio",
          audio: { id: "media-2", mime_type: "audio/ogg" },
        },
      ],
    });

    const [message] = toInboundMessages(audio, ACCOUNT, NOW);

    expect(message?.content).toEqual([{ kind: "unsupported", description: "nota de voz recibida" }]);
  });

  it("una ubicación viaja con sus coordenadas", () => {
    const ubicacion = payload({
      messages: [
        {
          from: "573001114444",
          id: "wamid.loc",
          timestamp: "1786028400",
          type: "location",
          location: { latitude: 6.2442, longitude: -75.5812 },
        },
      ],
    });

    const [message] = toInboundMessages(ubicacion, ACCOUNT, NOW);

    expect(message?.content).toEqual([
      { kind: "location", latitude: 6.2442, longitude: -75.5812 },
    ]);
  });

  it("descarta lo que no es procesable en vez de romperse", () => {
    const basura = payload({
      messages: [
        { from: "573001114444", type: "text", text: { body: "sin id" } },
        { id: "wamid.x", type: "text", text: { body: "sin remitente" } },
        { from: "573001114444", id: "wamid.y", type: "text", text: { body: "   " } },
      ],
    });

    expect(toInboundMessages(basura, ACCOUNT, NOW)).toHaveLength(0);
  });

  it("un payload vacío o inesperado no produce nada ni lanza", () => {
    expect(toInboundMessages({}, ACCOUNT, NOW)).toHaveLength(0);
    expect(toInboundMessages({ entry: [] }, ACCOUNT, NOW)).toHaveLength(0);
    expect(toInboundMessages({ entry: [{ changes: [{}] }] }, ACCOUNT, NOW)).toHaveLength(0);
  });

  it("un webhook de solo acuses no produce mensajes", () => {
    const soloEstados = payload({
      statuses: [
        { id: "wamid.out", status: "delivered", timestamp: "1786028400", recipient_id: "5730011" },
      ],
    });

    expect(toInboundMessages(soloEstados, ACCOUNT, NOW)).toHaveLength(0);
  });
});

describe("Payload de WhatsApp → acuses de entrega", () => {
  it("traduce los estados que conoce", () => {
    const estados = payload({
      statuses: [
        { id: "wamid.a", status: "sent", timestamp: "1786028400" },
        { id: "wamid.b", status: "delivered", timestamp: "1786028401" },
        { id: "wamid.c", status: "read", timestamp: "1786028402" },
      ],
    });

    const updates = toDeliveryStatuses(estados, NOW);

    expect(updates.map((u) => u.status)).toEqual(["SENT", "DELIVERED", "READ"]);
    expect(updates[0]?.providerMessageId).toBe("wamid.a");
  });

  it("un fallo conserva el motivo para que se pueda diagnosticar", () => {
    const fallo = payload({
      statuses: [
        {
          id: "wamid.f",
          status: "failed",
          timestamp: "1786028400",
          errors: [{ code: 131_047, title: "Re-engagement message", message: "fuera de ventana" }],
        },
      ],
    });

    const [update] = toDeliveryStatuses(fallo, NOW);

    expect(update?.status).toBe("FAILED");
    expect(update?.reason).toBe("Re-engagement message");
  });

  it("ignora estados desconocidos en vez de inventarse uno", () => {
    const raro = payload({ statuses: [{ id: "wamid.z", status: "teletransportado" }] });

    expect(toDeliveryStatuses(raro, NOW)).toHaveLength(0);
  });
});
