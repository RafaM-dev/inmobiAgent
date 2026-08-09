import { describe, expect, it } from "vitest";
import { UpstreamError, type AppError } from "../../../../platform/errors/app-error";
import type { EventEnvelope } from "../../../../platform/events/event";
import { NoopLogger } from "../../../../platform/logging/logger";
import type { Notification, Notifier } from "../../../../platform/notifications/notifier";
import { err, ok, type Result } from "../../../../platform/result/result";
import type { ConversationService } from "../../../conversation";
import type { TenantDirectory } from "../../../identity";
import type { HandoffRequestedPayload } from "../events/agent.events";
import { onHandoffRequested } from "./on-handoff-requested";

class RecordingNotifier implements Notifier {
  readonly channel = "recording";
  readonly sent: Notification[] = [];

  send(notification: Notification): Promise<Result<void, AppError>> {
    this.sent.push(notification);
    return Promise.resolve(ok(undefined));
  }
}

class FailingNotifier implements Notifier {
  readonly channel = "failing";

  send(): Promise<Result<void, AppError>> {
    return Promise.resolve(err(new UpstreamError("smtp", "unavailable")));
  }
}

const tenantWith = (handoffEmail?: string): TenantDirectory =>
  ({
    findById: () =>
      Promise.resolve({
        id: "t1",
        name: "Inmobiliaria Demo",
        settings: { ...(handoffEmail !== undefined ? { handoffEmail } : {}) },
      }),
  }) as unknown as TenantDirectory;

const conversationSaying = (text: string): ConversationService =>
  ({
    getContext: () =>
      Promise.resolve(
        ok({
          contactName: "Ana Restrepo",
          messages: [
            { role: "contact", text: "Hola" },
            { role: "assistant", text: "¿En qué te ayudo?" },
            { role: "contact", text },
          ],
        }),
      ),
  }) as unknown as ConversationService;

const envelope = (
  payload: Partial<HandoffRequestedPayload> = {},
): EventEnvelope<HandoffRequestedPayload> =>
  ({
    eventId: "e1",
    tenantId: "t1",
    occurredAt: new Date(),
    payload: {
      conversationId: "c1",
      contactId: "k1",
      reason: "USER_REQUEST",
      ...payload,
    },
  }) as EventEnvelope<HandoffRequestedPayload>;

const build = (overrides: {
  notifier: Notifier;
  tenants?: TenantDirectory;
  conversations?: ConversationService;
}) =>
  onHandoffRequested({
    tenants: overrides.tenants ?? tenantWith("asesor@demo.co"),
    conversations: overrides.conversations ?? conversationSaying("Quiero hablar con alguien"),
    notifier: overrides.notifier,
    backofficeUrl: "https://panel.agentinmobi.co",
    logger: new NoopLogger(),
  });

describe("Aviso de escalado", () => {
  it("avisa al correo configurado por la inmobiliaria", async () => {
    const notifier = new RecordingNotifier();
    await build({ notifier }).handle(envelope());

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.to).toBe("asesor@demo.co");
  });

  it("el asunto identifica inmobiliaria y cliente, para no abrirlo a ciegas", async () => {
    const notifier = new RecordingNotifier();
    await build({ notifier }).handle(envelope());

    expect(notifier.sent[0]?.subject).toBe("[Inmobiliaria Demo] Ana Restrepo necesita a una persona");
  });

  it("el cuerpo lleva el motivo en castellano, no el código interno", async () => {
    const notifier = new RecordingNotifier();
    await build({ notifier }).handle(envelope({ reason: "BUDGET_EXHAUSTED" }));

    const body = notifier.sent[0]?.body ?? "";
    expect(body).toContain("se ha agotado el presupuesto de IA del mes");
    expect(body).not.toContain("BUDGET_EXHAUSTED");
  });

  it("incluye lo ÚLTIMO que escribió el cliente, no lo primero", async () => {
    const notifier = new RecordingNotifier();
    await build({
      notifier,
      conversations: conversationSaying("Me urge, ¿alguien me llama hoy?"),
    }).handle(envelope());

    const body = notifier.sent[0]?.body ?? "";
    expect(body).toContain("Me urge, ¿alguien me llama hoy?");
    expect(body).not.toContain("Hola\n");
  });

  it("lleva el enlace al hilo concreto", async () => {
    const notifier = new RecordingNotifier();
    await build({ notifier }).handle(envelope({ conversationId: "abc-123" }));

    expect(notifier.sent[0]?.body).toContain("https://panel.agentinmobi.co/inbox/abc-123");
  });

  it("sin correo configurado no avisa, y tampoco falla", async () => {
    const notifier = new RecordingNotifier();

    await expect(
      build({ notifier, tenants: tenantWith(undefined) }).handle(envelope()),
    ).resolves.toBeUndefined();
    expect(notifier.sent).toHaveLength(0);
  });

  it("si el correo no sale, LANZA: es lo que hace que el outbox lo reintente", async () => {
    await expect(build({ notifier: new FailingNotifier() }).handle(envelope())).rejects.toThrow(
      /No se pudo avisar del escalado/,
    );
  });

  it("si no se puede leer la conversación, avisa igual: mejor parco que mudo", async () => {
    const notifier = new RecordingNotifier();
    const broken = {
      getContext: () => Promise.resolve(err(new UpstreamError("db", "unavailable"))),
    } as unknown as ConversationService;

    await build({ notifier, conversations: broken }).handle(envelope());

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.body).toContain("Un cliente está esperando");
  });
});
