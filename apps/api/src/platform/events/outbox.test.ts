import { describe, expect, it } from "vitest";
import { FixedClock } from "../clock/clock";
import { SequentialIdGenerator } from "../ids/id-generator";
import { InMemoryLogger } from "../logging/logger";
import type { EventEnvelope } from "./event";
import { defineEvent } from "./event";
import type { EventBus } from "./event-bus";
import { OutboxEventPublisher } from "./event-publisher";
import { OutboxRelay, type OutboxRecord, type OutboxStore } from "./outbox";

const leadCaptured = defineEvent<{ leadId: string }>("lead.captured");

/** Store en memoria con la misma semántica que el de Postgres. */
class FakeOutboxStore implements OutboxStore {
  readonly pending: OutboxRecord[] = [];
  readonly published: string[] = [];
  readonly failures: { id: string; error: string; nextAttemptAt: Date }[] = [];
  readonly deadLettered: { id: string; error: string }[] = [];
  private seq = 0;

  enqueue(envelope: EventEnvelope): Promise<void> {
    this.seq += 1;
    this.pending.push({
      id: `row-${String(this.seq)}`,
      envelope,
      attempts: 0,
      availableAt: envelope.occurredAt,
    });
    return Promise.resolve();
  }

  reserveBatch(limit: number): Promise<OutboxRecord[]> {
    return Promise.resolve(this.pending.splice(0, limit));
  }

  markPublished(ids: readonly string[]): Promise<void> {
    this.published.push(...ids);
    return Promise.resolve();
  }

  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    this.failures.push({ id, error, nextAttemptAt });
    return Promise.resolve();
  }

  markDeadLettered(id: string, error: string): Promise<void> {
    this.deadLettered.push({ id, error });
    return Promise.resolve();
  }
}

class FakeBus implements EventBus {
  readonly delivered: EventEnvelope[] = [];
  shouldFail = false;

  publish(): Promise<void> {
    return Promise.resolve();
  }
  publishEnvelope(envelope: EventEnvelope): Promise<void> {
    if (this.shouldFail) return Promise.reject(new Error("bus caído"));
    this.delivered.push(envelope);
    return Promise.resolve();
  }
  subscribe(): void {}
}

const build = () => {
  const store = new FakeOutboxStore();
  const bus = new FakeBus();
  const clock = new FixedClock(new Date("2026-01-01T10:00:00Z"));
  const relay = new OutboxRelay(
    { store, bus, clock, logger: new InMemoryLogger() },
    { maxAttempts: 3, baseBackoffMs: 1000, pollIntervalMs: 10_000 },
  );
  const publisher = new OutboxEventPublisher({
    outbox: store,
    clock,
    ids: new SequentialIdGenerator("evt"),
  });
  return { store, bus, clock, relay, publisher };
};

describe("Outbox", () => {
  it("publicar escribe en el outbox y NO entrega todavía", async () => {
    const { store, bus, publisher } = build();

    await publisher.publish(leadCaptured, { leadId: "lead-1" }, { tenantId: "t1" });

    expect(store.pending).toHaveLength(1);
    expect(bus.delivered).toHaveLength(0);
  });

  it("el relay entrega lo pendiente y lo marca como publicado", async () => {
    const { store, bus, relay, publisher } = build();
    await publisher.publish(leadCaptured, { leadId: "lead-1" }, { tenantId: "t1" });

    const processed = await relay.tick();
    await relay.stop();

    expect(processed).toBe(1);
    expect(bus.delivered).toHaveLength(1);
    expect(bus.delivered[0]?.type).toBe("lead.captured");
    expect(store.published).toEqual(["row-1"]);
  });

  it("reprograma con backoff exponencial cuando la entrega falla", async () => {
    const { store, bus, clock, relay, publisher } = build();
    await publisher.publish(leadCaptured, { leadId: "lead-1" }, { tenantId: "t1" });
    bus.shouldFail = true;

    await relay.tick();
    await relay.stop();

    expect(store.failures).toHaveLength(1);
    const delay = store.failures[0]!.nextAttemptAt.getTime() - clock.nowMs();
    // Primer reintento: 1000 ms de base + jitter (< 1000 ms).
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(2000);
  });

  it("envía a dead-letter tras agotar los intentos, sin bloquear la cola", async () => {
    const { store, bus, relay } = build();
    bus.shouldFail = true;

    store.pending.push({
      id: "row-viejo",
      envelope: {
        eventId: "evt-1",
        type: leadCaptured.type,
        version: 1,
        tenantId: "t1",
        occurredAt: new Date(),
        correlationId: "corr-1",
        payload: { leadId: "lead-1" },
      },
      attempts: 2, // ya van 2 de 3
      availableAt: new Date(),
    });

    await relay.tick();
    await relay.stop();

    expect(store.deadLettered).toHaveLength(1);
    expect(store.deadLettered[0]?.id).toBe("row-viejo");
    expect(store.failures).toHaveLength(0);
  });

  it("un fallo del relay no propaga la excepción al ciclo", async () => {
    const { relay } = build();
    await expect(relay.tick()).resolves.toBe(0);
    await relay.stop();
  });
});
