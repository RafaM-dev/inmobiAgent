import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../../platform/clock/clock";
import { NotFoundError, type AppError } from "../../../../../platform/errors/app-error";
import { NoopLogger } from "../../../../../platform/logging/logger";
import { err, isErr, isOk, ok, okVoid, type Result } from "../../../../../platform/result/result";
import type { ChannelCredentials } from "../../../application/ports/channel-credentials";
import type { ChannelAccountView } from "../../../application/ports/chat-channel";
import { ChannelType } from "../../../domain/value-objects/channel-type";
import { WhatsAppChannel } from "./whatsapp-channel";
import type { SendMessageInput, SendMessageOutput, WhatsAppClient } from "./whatsapp.client";

const NOW = new Date("2026-08-06T15:00:00Z");

const ACCOUNT: ChannelAccountView = {
  id: "acc-1",
  tenantId: "tenant-1",
  channelType: ChannelType.WHATSAPP,
  externalId: "1234567890",
  displayName: "Inmobiliaria Demo",
  config: {},
};

/** Cliente que registra lo enviado y puede fallar cuando se le pida. */
class RecordingClient implements WhatsAppClient {
  readonly sent: SendMessageInput[] = [];
  failAt: number | undefined;

  send(input: SendMessageInput): Promise<Result<SendMessageOutput, AppError>> {
    this.sent.push(input);

    if (this.failAt !== undefined && this.sent.length === this.failAt) {
      return Promise.resolve(err(new NotFoundError("Proveedor caído")));
    }
    return Promise.resolve(ok({ providerMessageId: `wamid.${String(this.sent.length)}` }));
  }
}

class StaticCredentials implements ChannelCredentials {
  constructor(private readonly values: Record<string, string> | null) {}

  get(accountId: string): Promise<Result<Readonly<Record<string, string>>, AppError>> {
    return Promise.resolve(
      this.values ? ok(this.values) : err(new NotFoundError("Credenciales", accountId)),
    );
  }

  set(): Promise<Result<void, AppError>> {
    return Promise.resolve(okVoid());
  }
}

const build = (options: { credentials?: Record<string, string> | null } = {}) => {
  const client = new RecordingClient();
  const channel = new WhatsAppChannel({
    client,
    credentials: new StaticCredentials(
      options.credentials === undefined ? { accessToken: "EAAG-token" } : options.credentials,
    ),
    clock: new FixedClock(NOW),
    logger: new NoopLogger(),
  });

  return { channel, client };
};

describe("WhatsAppChannel — envío", () => {
  it("envía cada bloque como un mensaje, en orden", async () => {
    const { channel, client } = build();

    const receipt = await channel.send({
      account: ACCOUNT,
      toExternalId: "573001114444",
      blocks: [
        { kind: "text", text: "Estos son los horarios:" },
        { kind: "quick_replies", prompt: "Elige", options: [{ label: "Hoy", value: "hoy" }] },
      ],
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    if (!isOk(receipt)) throw new Error("debería enviar");
    expect(client.sent.map((s) => s.message.type)).toEqual(["text", "interactive"]);
    expect(receipt.value.providerMessageIds).toEqual(["wamid.1", "wamid.2"]);
  });

  it("usa el identificador externo de la cuenta como phone_number_id", async () => {
    const { channel, client } = build();

    await channel.send({
      account: ACCOUNT,
      toExternalId: "573001114444",
      blocks: [{ kind: "text", text: "hola" }],
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    expect(client.sent[0]?.phoneNumberId).toBe("1234567890");
    expect(client.sent[0]?.accessToken).toBe("EAAG-token");
  });

  it("sin credenciales no envía nada", async () => {
    const { channel, client } = build({ credentials: null });

    const receipt = await channel.send({
      account: ACCOUNT,
      toExternalId: "573001114444",
      blocks: [{ kind: "text", text: "hola" }],
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    expect(isErr(receipt)).toBe(true);
    expect(client.sent).toHaveLength(0);
  });

  it("sin token de acceso falla de forma explícita", async () => {
    const { channel } = build({ credentials: { appSecret: "solo-el-secreto" } });

    const receipt = await channel.send({
      account: ACCOUNT,
      toExternalId: "573001114444",
      blocks: [{ kind: "text", text: "hola" }],
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    expect(isErr(receipt)).toBe(true);
  });

  it("si falla el segundo mensaje, se detiene y devuelve el error", async () => {
    const { channel, client } = build();
    client.failAt = 2;

    const receipt = await channel.send({
      account: ACCOUNT,
      toExternalId: "573001114444",
      blocks: [
        { kind: "text", text: "uno" },
        { kind: "text", text: "dos" },
        { kind: "text", text: "tres" },
      ],
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    expect(isErr(receipt)).toBe(true);
    // No se sigue mandando después de un fallo: el cliente ya vio una respuesta
    // cortada y añadir más empeora la lectura.
    expect(client.sent).toHaveLength(2);
  });
});

describe("WhatsAppChannel — entrada", () => {
  it("rechaza un cuerpo que no sea un objeto", () => {
    const { channel } = build();

    expect(isErr(channel.normalizeInbound("no soy un objeto", ACCOUNT))).toBe(true);
    expect(isErr(channel.normalizeInbound(null, ACCOUNT))).toBe(true);
  });

  it("un webhook sin mensajes devuelve una lista vacía, no un error", () => {
    const { channel } = build();

    // Meta manda notificaciones que no son mensajes; no son un fallo.
    const result = channel.normalizeInbound({ object: "whatsapp_business_account" }, ACCOUNT);

    if (!isOk(result)) throw new Error("debería aceptar");
    expect(result.value).toHaveLength(0);
  });

  it("los acuses de entrega se extraen del mismo payload", () => {
    const { channel } = build();

    const updates = channel.normalizeStatuses(
      {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: "wamid.out", status: "delivered", timestamp: "1786028400" }],
                },
              },
            ],
          },
        ],
      },
      ACCOUNT,
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe("DELIVERED");
  });

  it("declara sus capacidades reales", () => {
    const capabilities = build().channel.capabilities(ACCOUNT);

    expect(capabilities.supportsQuickReplies).toBe(true);
    expect(capabilities.supportsStreaming).toBe(false);
    expect(capabilities.maxTextLength).toBe(4096);
  });
});
