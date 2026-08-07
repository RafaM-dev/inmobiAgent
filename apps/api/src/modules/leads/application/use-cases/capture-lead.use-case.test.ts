import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../../platform/clock/clock";
import { NoopUnitOfWork } from "../../../../platform/database/unit-of-work";
import { RecordingEventPublisher } from "../../../../platform/events/event-publisher";
import { SequentialIdGenerator } from "../../../../platform/ids/id-generator";
import { isOk, ok, okVoid, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { ChannelType } from "../../../channels";
import {
  slot,
  SlotSource,
  type ConversationContext,
  type ConversationService,
  type ProfileSlots,
} from "../../../conversation";
import type { AdvisorDirectory, AdvisorView } from "../../../identity";
import { LeadStatus } from "../../domain/entities/lead";
import { LeadBand } from "../../domain/value-objects/lead-score";
import { InMemoryLeadRepository } from "../../testing/in-memory-lead.repository";
import { LeadAssigned, LeadCaptured } from "../events/leads.events";
import { LeadQualifier } from "../services/lead-qualifier";
import { CaptureLeadUseCase } from "./capture-lead.use-case";

const NOW = new Date("2026-08-06T15:00:00Z");
const TENANT = "tenant-1";
const CONVERSATION = "conv-1";

/** Fake local: `leads` no debe conocer las tripas de `conversation` ni en tests. */
class FakeConversations implements ConversationService {
  profile: ProfileSlots = {};
  contactMessages = 1;

  getContext(conversationId: string): Promise<Result<ConversationContext, never>> {
    return Promise.resolve(
      ok({
        conversationId,
        contactId: "contact-1",
        contactName: "Cliente",
        channelType: ChannelType.CONSOLE,
        channelAccountId: "acc-1",
        externalContactId: "demo-user",
        status: "OPEN" as const,
        stage: "DISCOVERY" as const,
        messages: Array.from({ length: this.contactMessages }, () => ({
          role: "contact" as const,
          text: "hola",
          sentAt: NOW,
        })),
        profile: this.profile,
        missingRequiredSlots: [],
      }),
    );
  }

  reply(): Promise<Result<{ messageId: string; delivered: boolean }, never>> {
    return Promise.resolve(ok({ messageId: "msg-1", delivered: true }));
  }

  remember(): Promise<Result<never[], never>> {
    return Promise.resolve(ok([]));
  }

  pauseBot(): Promise<Result<void, never>> {
    return Promise.resolve(okVoid());
  }
}

class FakeAdvisors implements AdvisorDirectory {
  constructor(private readonly advisors: AdvisorView[] = []) {}

  listAssignable(): Promise<readonly AdvisorView[]> {
    return Promise.resolve(this.advisors);
  }

  findById(userId: string): Promise<AdvisorView | null> {
    return Promise.resolve(this.advisors.find((a) => a.id === userId) ?? null);
  }
}

const advisor = (id: string): AdvisorView => ({
  id,
  displayName: id,
  email: `${id}@demo.co`,
});

const build = (advisors: AdvisorView[] = []) => {
  const leads = new InMemoryLeadRepository();
  const conversations = new FakeConversations();
  const events = new RecordingEventPublisher();
  const clock = new FixedClock(NOW);

  const capture = new CaptureLeadUseCase({
    leads,
    conversations,
    qualifier: new LeadQualifier({
      leads,
      advisors: new FakeAdvisors(advisors),
      events,
      clock,
    }),
    unitOfWork: new NoopUnitOfWork(),
    events,
    clock,
    ids: new SequentialIdGenerator("lead"),
  });

  return { capture, leads, conversations, events };
};

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run({ tenantId: TENANT, correlationId: "test", source: "test" }, fn);

describe("CaptureLead — de conversación a ficha comercial", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it("captura un lead nuevo y publica el evento una sola vez", async () => {
    const first = await inTenant(() =>
      harness.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );

    if (!isOk(first)) throw new Error("debería capturar");
    expect(first.value.created).toBe(true);
    expect(first.value.status).toBe(LeadStatus.NEW);
    expect(harness.events.ofType(LeadCaptured)).toHaveLength(1);
  });

  it("es idempotente por conversación: diez llamadas, un lead", async () => {
    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(
        await inTenant(() =>
          harness.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
        ),
      );
    }

    const ids = new Set(results.map((r) => (isOk(r) ? r.value.id : "")));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => isOk(r) && r.value.created)).toHaveLength(1);
    expect(harness.events.ofType(LeadCaptured)).toHaveLength(1);
  });

  it("los requisitos salen de la memoria de la conversación, no del comando", async () => {
    harness.conversations.profile = {
      operation: slot("RENT", SlotSource.USER, NOW),
      city: slot("Medellín", SlotSource.USER, NOW),
      propertyType: slot(["APARTMENT"], SlotSource.USER, NOW),
      budget: slot({ max: 2_000_000_00, currency: "COP" }, SlotSource.USER, NOW),
    };

    await inTenant(() =>
      harness.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );

    const lead = await inTenant(() => harness.leads.findByConversation(CONVERSATION));
    expect(lead?.requirements).toEqual({
      operation: "RENT",
      city: "Medellín",
      propertyTypes: ["APARTMENT"],
      budget: { max: 2_000_000_00, currency: "COP" },
    });
  });

  it("un cliente con criterios completos que pide visita se cualifica solo", async () => {
    harness.conversations.profile = {
      name: slot("Ana", SlotSource.USER, NOW),
      operation: slot("RENT", SlotSource.USER, NOW),
      city: slot("Medellín", SlotSource.USER, NOW),
      propertyType: slot(["APARTMENT"], SlotSource.USER, NOW),
      budget: slot({ max: 2_000_000_00, currency: "COP" }, SlotSource.USER, NOW),
    };

    const result = await inTenant(() =>
      harness.capture.execute({
        conversationId: CONVERSATION,
        contactId: "contact-1",
        visitRequested: true,
      }),
    );

    if (!isOk(result)) throw new Error("debería capturar");
    expect(result.value.band).not.toBe(LeadBand.COLD);
    expect(result.value.status).toBe(LeadStatus.QUALIFIED);
  });

  it("un lead frío no se cualifica ni se asigna", async () => {
    const withAdvisors = build([advisor("user-1")]);

    const result = await inTenant(() =>
      withAdvisors.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );

    if (!isOk(result)) throw new Error("debería capturar");
    expect(result.value.status).toBe(LeadStatus.NEW);
    expect(result.value.assignedUserId).toBeUndefined();
    expect(withAdvisors.events.ofType(LeadAssigned)).toHaveLength(0);
  });

  it("al cualificarse se asigna a un asesor, y solo una vez", async () => {
    const withAdvisors = build([advisor("user-1"), advisor("user-2")]);
    withAdvisors.conversations.profile = {
      operation: slot("RENT", SlotSource.USER, NOW),
      city: slot("Medellín", SlotSource.USER, NOW),
      propertyType: slot(["APARTMENT"], SlotSource.USER, NOW),
      budget: slot({ max: 2_000_000_00, currency: "COP" }, SlotSource.USER, NOW),
    };

    await inTenant(() =>
      withAdvisors.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );
    await inTenant(() =>
      withAdvisors.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );

    const assigned = withAdvisors.events.ofType(LeadAssigned);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.userId).toBe("user-1");
  });

  it("sin asesores dados de alta, el lead queda sin asignar en vez de fallar", async () => {
    harness.conversations.profile = {
      operation: slot("RENT", SlotSource.USER, NOW),
      city: slot("Medellín", SlotSource.USER, NOW),
      propertyType: slot(["APARTMENT"], SlotSource.USER, NOW),
      budget: slot({ max: 2_000_000_00, currency: "COP" }, SlotSource.USER, NOW),
    };

    const result = await inTenant(() =>
      harness.capture.execute({ conversationId: CONVERSATION, contactId: "contact-1" }),
    );

    if (!isOk(result)) throw new Error("debería capturar");
    expect(result.value.assignedUserId).toBeUndefined();
    expect(result.value.status).toBe(LeadStatus.QUALIFIED);
  });
});
