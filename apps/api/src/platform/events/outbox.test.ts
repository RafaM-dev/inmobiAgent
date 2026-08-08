import { describe, expect, it } from "vitest";
import { FixedClock } from "../clock/clock";
import { SequentialIdGenerator } from "../ids/id-generator";
import { InMemoryLogger } from "../logging/logger";
import { createAppMetrics } from "../telemetry/app-metrics";
import { PrometheusMetrics } from "../telemetry/prometheus-metrics";
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
  // Registro real, no un doble: así el test comprueba lo que saldría de verdad
  // por `/metrics`, no solo que se llame al contador.
  const registry = new PrometheusMetrics({ logger: new InMemoryLogger() });
  const relay = new OutboxRelay(
    { store, bus, clock, logger: new InMemoryLogger(), metrics: createAppMetrics(registry) },
    { maxAttempts: 3, baseBackoffMs: 1000, pollIntervalMs: 10_000 },
  );
  const publisher = new OutboxEventPublisher({
    outbox: store,
    clock,
    ids: new SequentialIdGenerator("evt"),
  });
  return { store, bus, clock, relay, publisher, registry };
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

  describe("métricas", () => {
    it("mide el retraso desde que se ENCOLÓ, no desde que se reservó", async () => {
      const { store, clock, relay, registry } = build();

      store.pending.push({
        id: "row-viejo",
        envelope: {
          eventId: "evt-1",
          type: leadCaptured.type,
          version: 1,
          tenantId: "t1",
          // Encolado hace cuarenta segundos: la cola no daba abasto.
          occurredAt: new Date(clock.nowMs() - 40_000),
          correlationId: "corr-1",
          payload: { leadId: "lead-1" },
        },
        attempts: 0,
        availableAt: new Date(),
      });

      await relay.tick();
      await relay.stop();

      /*
       * La entrega en sí fue instantánea, y ahí está la trampa que esto evita:
       * medir desde la reserva daría un retraso de cero y una gráfica plana
       * mientras los clientes esperan cuarenta segundos por su respuesta.
       */
      const salida = registry.render();
      expect(salida).toContain('agentinmobi_outbox_lag_seconds_sum{event="lead.captured"} 40');
      expect(salida).toContain('agentinmobi_outbox_lag_seconds_bucket{event="lead.captured",le="30"} 0');
      expect(salida).toContain('agentinmobi_outbox_lag_seconds_bucket{event="lead.captured",le="60"} 1');
    });

    it("cuenta las entregas, los reintentos y los descartes por separado", async () => {
      const { store, bus, relay, publisher, registry } = build();

      await publisher.publish(leadCaptured, { leadId: "lead-1" }, { tenantId: "t1" });
      await relay.tick();

      bus.shouldFail = true;
      await publisher.publish(leadCaptured, { leadId: "lead-2" }, { tenantId: "t1" });
      await relay.tick();

      store.pending.push({
        id: "row-agotado",
        envelope: {
          eventId: "evt-9",
          type: leadCaptured.type,
          version: 1,
          tenantId: "t1",
          occurredAt: new Date(),
          correlationId: "corr-9",
          payload: { leadId: "lead-9" },
        },
        attempts: 2,
        availableAt: new Date(),
      });
      await relay.tick();
      await relay.stop();

      const salida = registry.render();
      expect(salida).toContain('agentinmobi_outbox_delivered_total{event="lead.captured"} 1');
      expect(salida).toContain('agentinmobi_outbox_retried_total{event="lead.captured"} 1');
      // Cualquier valor distinto de cero aquí es una alerta: son eventos que
      // el sistema perdió para siempre.
      expect(salida).toContain('agentinmobi_outbox_dead_lettered_total{event="lead.captured"} 1');
    });
  });
});
