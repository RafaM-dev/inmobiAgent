import { describe, expect, it } from "vitest";
import { FixedClock } from "../clock/clock";
import { SequentialIdGenerator } from "../ids/id-generator";
import { InMemoryLogger } from "../logging/logger";
import { TenantContext } from "../tenancy/tenant-context";
import { defineEvent, subscription } from "./event";
import { InMemoryIdempotencyStore, InProcessEventBus } from "./event-bus";

interface LeadCaptured {
  leadId: string;
}
const leadCaptured = defineEvent<LeadCaptured>("lead.captured");

const buildBus = () => {
  const logger = new InMemoryLogger();
  const bus = new InProcessEventBus({
    logger,
    clock: new FixedClock(new Date("2026-01-01T10:00:00Z")),
    ids: new SequentialIdGenerator("evt"),
    idempotency: new InMemoryIdempotencyStore(),
  });
  return { bus, logger };
};

describe("InProcessEventBus", () => {
  it("entrega el evento a todos sus consumidores", async () => {
    const { bus } = buildBus();
    const seenBy: string[] = [];

    bus.subscribe(
      subscription("notify-advisor", leadCaptured, () => {
        seenBy.push("notify-advisor");
      }),
    );
    bus.subscribe(
      subscription("update-analytics", leadCaptured, () => {
        seenBy.push("update-analytics");
      }),
    );

    await bus.publish(leadCaptured, { leadId: "lead-1" });

    expect(seenBy).toEqual(["notify-advisor", "update-analytics"]);
  });

  it("aísla los fallos: un consumidor roto no impide que los demás procesen", async () => {
    const { bus, logger } = buildBus();
    let healthyRan = false;

    bus.subscribe(
      subscription("broken", leadCaptured, () => {
        throw new Error("proveedor de email caído");
      }),
    );
    bus.subscribe(
      subscription("healthy", leadCaptured, () => {
        healthyRan = true;
      }),
    );

    await expect(bus.publish(leadCaptured, { leadId: "lead-1" })).resolves.toBeUndefined();
    expect(healthyRan).toBe(true);
    expect(logger.entries.some((e) => e.level === "error")).toBe(true);
  });

  it("no procesa dos veces el mismo evento en el mismo consumidor", async () => {
    const { bus } = buildBus();
    let calls = 0;

    bus.subscribe(
      subscription("counter", leadCaptured, () => {
        calls += 1;
      }),
    );

    const envelope = {
      eventId: "evt-fijo",
      type: leadCaptured.type,
      version: 1,
      tenantId: "t1",
      occurredAt: new Date(),
      correlationId: "corr-1",
      payload: { leadId: "lead-1" },
    };

    await bus.publishEnvelope(envelope);
    await bus.publishEnvelope(envelope); // reintento del relay

    expect(calls).toBe(1);
  });

  it("libera la marca de idempotencia si el consumidor falla, para permitir reintentos", async () => {
    const { bus } = buildBus();
    let attempts = 0;

    bus.subscribe(
      subscription("flaky", leadCaptured, () => {
        attempts += 1;
        if (attempts === 1) throw new Error("fallo transitorio");
      }),
    );

    const envelope = {
      eventId: "evt-fijo",
      type: leadCaptured.type,
      version: 1,
      tenantId: "t1",
      occurredAt: new Date(),
      correlationId: "corr-1",
      payload: { leadId: "lead-1" },
    };

    await bus.publishEnvelope(envelope);
    await bus.publishEnvelope(envelope);

    expect(attempts).toBe(2);
  });

  it("rechaza dos suscripciones con el mismo nombre (romperían la idempotencia)", () => {
    const { bus } = buildBus();
    bus.subscribe(subscription("dup", leadCaptured, () => undefined));

    expect(() => {
      bus.subscribe(subscription("dup", leadCaptured, () => undefined));
    }).toThrow(/duplicada/i);
  });

  it("hereda tenant y correlación del ExecutionContext activo", async () => {
    const { bus } = buildBus();
    let captured: { tenantId: string; correlationId: string } | undefined;

    bus.subscribe(
      subscription("capture", leadCaptured, (envelope) => {
        captured = { tenantId: envelope.tenantId, correlationId: envelope.correlationId };
      }),
    );

    await TenantContext.run(
      { tenantId: "inmobiliaria-abc", correlationId: "corr-xyz", source: "webhook" },
      () => bus.publish(leadCaptured, { leadId: "lead-1" }),
    );

    expect(captured).toEqual({ tenantId: "inmobiliaria-abc", correlationId: "corr-xyz" });
  });
});
