import { describe, expect, it } from "vitest";
import { DomainError } from "../../../../platform/errors/app-error";
import { ChannelType } from "../../../channels";
import { Conversation, ConversationStage, ConversationStatus } from "./conversation";

const now = new Date("2026-03-01T09:00:00.000Z");

const start = (): Conversation =>
  Conversation.start({
    id: "c1",
    tenantId: "t1",
    contactId: "ct1",
    channelAccountId: "acc1",
    channelType: ChannelType.CONSOLE,
    externalContactId: "+573001112233",
    now,
  });

describe("Conversation", () => {
  it("nace abierta y en etapa NEW", () => {
    const conversation = start();

    expect(conversation.status).toBe(ConversationStatus.OPEN);
    expect(conversation.stage).toBe(ConversationStage.NEW);
    expect(conversation.isBotActive).toBe(true);
  });

  it("el primer mensaje del cliente la lleva a DISCOVERY", () => {
    const conversation = start();

    conversation.registerInbound(new Date("2026-03-01T09:00:05.000Z"));

    expect(conversation.stage).toBe(ConversationStage.DISCOVERY);
    expect(conversation.lastActivityAt).toEqual(new Date("2026-03-01T09:00:05.000Z"));
  });

  it("no admite mensajes si está cerrada", () => {
    const conversation = start();
    conversation.close(now);

    expect(() => {
      conversation.registerInbound(now);
    }).toThrow(DomainError);
    expect(() => {
      conversation.registerOutbound(now);
    }).toThrow(DomainError);
  });

  it("con un humano al mando, el bot deja de estar activo", () => {
    const conversation = start();

    conversation.assignToHuman("u1", now);

    expect(conversation.status).toBe(ConversationStatus.HUMAN);
    expect(conversation.isBotActive).toBe(false);
    expect(conversation.assignedUserId).toBe("u1");
  });

  it("devolver al bot libera la asignación", () => {
    const conversation = start();
    conversation.assignToHuman("u1", now);

    conversation.returnToBot(now);

    expect(conversation.isBotActive).toBe(true);
    expect(conversation.assignedUserId).toBeUndefined();
  });

  it("reabrir devuelve a DISCOVERY, no a NEW: el contacto ya no es un desconocido", () => {
    const conversation = start();
    conversation.registerInbound(now);
    conversation.advanceStage(ConversationStage.PRESENTING, now);
    conversation.close(now);

    const later = new Date("2026-03-10T09:00:00.000Z");
    conversation.reopen(later);

    expect(conversation.status).toBe(ConversationStatus.OPEN);
    expect(conversation.stage).toBe(ConversationStage.DISCOVERY);
  });

  it("cerrar es idempotente", () => {
    const conversation = start();
    conversation.close(now);
    const closedAt = conversation.snapshot().closedAt;

    conversation.close(new Date("2026-03-02T09:00:00.000Z"));

    expect(conversation.snapshot().closedAt).toEqual(closedAt);
  });
});
