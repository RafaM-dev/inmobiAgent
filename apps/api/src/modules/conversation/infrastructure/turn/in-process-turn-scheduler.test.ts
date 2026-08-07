import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemClock } from "../../../../platform/clock/clock";
import { InMemoryLogger, NoopLogger } from "../../../../platform/logging/logger";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { ScheduleTurnCommand } from "../../application/ports/turn-scheduler";
import { InProcessTurnScheduler } from "./in-process-turn-scheduler";

const command = (conversationId = "c1"): ScheduleTurnCommand => ({
  tenantId: "t1",
  conversationId,
  correlationId: "corr-1",
});

const setup = (options = { debounceMs: 2500, maxWaitMs: 8000 }) => {
  const runs: { conversationId: string; tenantId: string | undefined }[] = [];

  const scheduler = new InProcessTurnScheduler({
    runTurn: (cmd) => {
      runs.push({ conversationId: cmd.conversationId, tenantId: TenantContext.peek()?.tenantId });
      return Promise.resolve();
    },
    clock: new SystemClock(),
    logger: new NoopLogger(),
    options,
  });

  return { scheduler, runs };
};

describe("InProcessTurnScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("agrupa varios mensajes seguidos en un solo turno", async () => {
    const { scheduler, runs } = setup();

    // "hola" / "busco apto" / "en Medellín", con menos de 2,5 s entre ellos.
    scheduler.schedule(command());
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule(command());
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule(command());

    expect(runs).toHaveLength(0); // todavía nadie ha respondido

    await vi.advanceTimersByTimeAsync(2500);

    expect(runs).toHaveLength(1);
  });

  it("respeta el tope máximo aunque el cliente no pare de escribir", async () => {
    const { scheduler, runs } = setup({ debounceMs: 2500, maxWaitMs: 6000 });

    scheduler.schedule(command());
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      scheduler.schedule(command());
    }

    // Sin tope máximo seguiríamos esperando indefinidamente.
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);
  });

  it("conversaciones distintas no se estorban", async () => {
    const { scheduler, runs } = setup();

    scheduler.schedule(command("c1"));
    scheduler.schedule(command("c2"));
    await vi.advanceTimersByTimeAsync(2500);

    expect(runs.map((r) => r.conversationId).sort()).toEqual(["c1", "c2"]);
  });

  it("cancelar impide que el turno llegue a ejecutarse", async () => {
    const { scheduler, runs } = setup();

    scheduler.schedule(command());
    scheduler.cancel("c1");
    await vi.advanceTimersByTimeAsync(5000);

    expect(runs).toHaveLength(0);
  });

  it("el turno corre con el contexto de tenant restablecido", async () => {
    const { scheduler, runs } = setup();

    scheduler.schedule(command());
    await vi.advanceTimersByTimeAsync(2500);

    expect(runs[0]?.tenantId).toBe("t1");
  });

  it("flushAll no deja turnos pendientes al apagar", async () => {
    const { scheduler, runs } = setup();

    scheduler.schedule(command("c1"));
    scheduler.schedule(command("c2"));
    await scheduler.flushAll();

    expect(runs).toHaveLength(2);
  });

  it("un turno que falla se registra y no impide los siguientes", async () => {
    let attempts = 0;
    const logger = new InMemoryLogger();

    const scheduler = new InProcessTurnScheduler({
      runTurn: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("proveedor caído")) : Promise.resolve();
      },
      clock: new SystemClock(),
      logger,
      options: { debounceMs: 100, maxWaitMs: 1000 },
    });

    scheduler.schedule(command());
    await vi.advanceTimersByTimeAsync(200);

    expect(logger.entries.some((e) => e.level === "error")).toBe(true);

    // El planificador sigue vivo: el siguiente turno se ejecuta con normalidad.
    scheduler.schedule(command());
    await vi.advanceTimersByTimeAsync(200);

    expect(attempts).toBe(2);
  });
});
