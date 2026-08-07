import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { RecordingEventPublisher } from "../../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../../platform/ids/id-generator";
import { NoopLogger } from "../../../../platform/logging/logger";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { ChannelType } from "../../../channels";
import {
  InMemoryContactProfileRepository,
  InMemoryContactRepository,
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  NoopConversationLock,
  RecordingTurnScheduler,
} from "../../testing/in-memory-conversation.repositories";
import { ConversationStarted, TurnReady } from "../events/conversation.events";
import { FlushTurnUseCase } from "./flush-turn.use-case";
import { IngestInboundMessageUseCase } from "./ingest-inbound-message.use-case";

const receivedAt = new Date("2026-05-01T15:00:00.000Z");

const setup = () => {
  const contacts = new InMemoryContactRepository();
  const conversations = new InMemoryConversationRepository();
  const messages = new InMemoryMessageRepository();
  const profiles = new InMemoryContactProfileRepository();
  const turnScheduler = new RecordingTurnScheduler();
  const events = new RecordingEventPublisher();
  const ids = new SequentialIdGenerator("id");

  const ingest = new IngestInboundMessageUseCase({
    contacts,
    conversations,
    messages,
    profiles,
    turnScheduler,
    unitOfWork: new NoopUnitOfWork(),
    events,
    clock: new FixedClock(receivedAt),
    ids,
    logger: new NoopLogger(),
  });

  const flushTurn = new FlushTurnUseCase({
    conversations,
    messages,
    lock: new NoopConversationLock(),
    unitOfWork: new NoopUnitOfWork(),
    events,
    ids,
    logger: new NoopLogger(),
  });

  return { ingest, flushTurn, contacts, conversations, messages, profiles, turnScheduler, events };
};

const inbound = (text: string, externalMessageId: string) => ({
  channelType: ChannelType.CONSOLE,
  channelAccountId: "acc-1",
  externalMessageId,
  externalContactId: "+573001112233",
  contactDisplayName: "Ana",
  content: [{ kind: "text", text }] as const,
  receivedAt,
});

const run = <T>(fn: () => Promise<T>, tenantId = "t1"): Promise<T> =>
  TenantContext.run({ tenantId, correlationId: "corr-1", source: "test" }, fn);

describe("IngestInboundMessageUseCase", () => {
  it("crea contacto, conversación, perfil y mensaje al primer contacto", async () => {
    const { ingest, contacts, conversations, profiles, messages, events } = setup();

    const result = await run(() => ingest.execute(inbound("hola", "ext-1")));

    expect(isOk(result)).toBe(true);
    expect(contacts.items.size).toBe(1);
    expect(conversations.items.size).toBe(1);
    expect(profiles.items.size).toBe(1);
    expect(messages.items.size).toBe(1);
    expect(events.ofType(ConversationStarted)).toHaveLength(1);
  });

  it("un reintento del proveedor no duplica nada", async () => {
    const { ingest, messages, conversations, turnScheduler } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")));
    const second = await run(() => ingest.execute(inbound("hola", "ext-1")));

    expect(isOk(second) && second.value.duplicated).toBe(true);
    expect(messages.items.size).toBe(1);
    expect(conversations.items.size).toBe(1);
    // Y, sobre todo, no se agenda un segundo turno.
    expect(turnScheduler.scheduled).toHaveLength(1);
  });

  it("mensajes seguidos del mismo contacto reutilizan la conversación abierta", async () => {
    const { ingest, conversations, contacts } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")));
    await run(() => ingest.execute(inbound("busco apto", "ext-2")));

    expect(contacts.items.size).toBe(1);
    expect(conversations.items.size).toBe(1);
  });

  it("los tres mensajes se cierran en UN turno con el texto unido", async () => {
    const { ingest, flushTurn, conversations, events } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")));
    await run(() => ingest.execute(inbound("busco apto", "ext-2")));
    await run(() => ingest.execute(inbound("en Medellín", "ext-3")));

    const conversationId = [...conversations.items.keys()][0] ?? "";
    const result = await run(() => flushTurn.execute(conversationId));

    expect(isOk(result) && result.value.messageCount).toBe(3);

    const turns = events.ofType(TurnReady);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe("hola\nbusco apto\nen Medellín");
  });

  it("un segundo turno no vuelve a consumir los mensajes ya procesados", async () => {
    const { ingest, flushTurn, conversations, events } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")));
    const conversationId = [...conversations.items.keys()][0] ?? "";

    await run(() => flushTurn.execute(conversationId));
    const second = await run(() => flushTurn.execute(conversationId));

    expect(isOk(second) && second.value.skippedReason).toBe("empty");
    expect(events.ofType(TurnReady)).toHaveLength(1);
  });

  it("el mismo número escribiendo a dos inmobiliarias son dos clientes distintos", async () => {
    // Caso real: una persona busca piso y escribe al mismo tiempo a dos
    // agencias desde su único teléfono. Cada una debe verla como su cliente,
    // con su propia conversación y su propia memoria.
    const { ingest, contacts, conversations } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")), "tenant-a");
    await run(() => ingest.execute(inbound("hola", "ext-2")), "tenant-b");

    expect(contacts.items.size).toBe(2);
    expect(conversations.items.size).toBe(2);

    const [a, b] = [...contacts.items.values()];
    expect(a?.tenantId).toBe("tenant-a");
    expect(b?.tenantId).toBe("tenant-b");

    // Y cada tenant solo ve al suyo.
    const fromA = await run(
      () => contacts.findByChannelIdentity(ChannelType.CONSOLE, "+573001112233"),
      "tenant-a",
    );
    expect(fromA?.tenantId).toBe("tenant-a");
  });

  it("si un humano tomó la conversación, el turno no se dispara", async () => {
    const { ingest, flushTurn, conversations, events } = setup();

    await run(() => ingest.execute(inbound("hola", "ext-1")));
    const conversationId = [...conversations.items.keys()][0] ?? "";
    conversations.items.get(conversationId)?.assignToHuman("u1", receivedAt);

    const result = await run(() => flushTurn.execute(conversationId));

    expect(isOk(result) && result.value.skippedReason).toBe("bot_inactive");
    expect(events.ofType(TurnReady)).toHaveLength(0);
  });
});
