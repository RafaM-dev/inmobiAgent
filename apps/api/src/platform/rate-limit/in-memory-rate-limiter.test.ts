import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../clock/clock";
import { NoopLogger } from "../logging/logger";
import { InMemoryRateLimiter } from "./in-memory-rate-limiter";
import type { Quota } from "./token-bucket";

const quota: Quota = { burst: 3, perMinute: 60 };

describe("Limitador de ritmo en memoria", () => {
  let clock: FixedClock;
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-08-08T10:00:00.000Z"));
    limiter = new InMemoryRateLimiter({ clock, logger: new NoopLogger() });
  });

  const consume = (key: string, cost?: number) =>
    limiter.consume({ key, quota, ...(cost === undefined ? {} : { cost }) });

  it("corta a la clave que se pasa y deja pasar al resto", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await consume("tenant-a")).allowed).toBe(true);
    }
    expect((await consume("tenant-a")).allowed).toBe(false);

    // La razón de ser del ámbito: que una inmobiliaria desbocada no deje sin
    // servicio a las demás.
    expect((await consume("tenant-b")).allowed).toBe(true);
  });

  it("vuelve a dejar pasar cuando pasa el tiempo que anunció", async () => {
    await consume("tenant-a");
    await consume("tenant-a");
    await consume("tenant-a");

    const rechazo = await consume("tenant-a");
    expect(rechazo.allowed).toBe(false);

    clock.advance(rechazo.retryAfterMs);
    expect((await consume("tenant-a")).allowed).toBe(true);
  });

  it("una cuota inactiva no limita nada", async () => {
    const sinTope = { burst: 0, perMinute: 0 };
    for (let i = 0; i < 50; i += 1) {
      expect((await limiter.consume({ key: "tenant-a", quota: sinTope })).allowed).toBe(true);
    }
    // Ni siquiera crea el cubo: sin cuota no hay nada que recordar.
    expect(limiter.size).toBe(0);
  });

  it("olvida las claves inactivas en vez de acumularlas para siempre", async () => {
    await consume("contacto-1");
    await consume("contacto-2");
    expect(limiter.size).toBe(2);

    /*
     * Un cubo que ya volvió a estar lleno no guarda información: borrarlo da
     * exactamente el mismo resultado que conservarlo. Por eso la limpieza es
     * segura, y por eso el proceso no crece con cada número de teléfono que
     * escribe una vez y no vuelve.
     */
    clock.advance(10 * 60_000);
    await consume("contacto-3");

    expect(limiter.size).toBe(1);
    // Y el que se olvidó vuelve a empezar lleno, que es lo que le tocaba.
    expect((await consume("contacto-1")).remaining).toBe(2);
  });

  it("no olvida a quien todavía está consumiendo", async () => {
    // Reposición lenta: tres fichas tardan tres minutos en volver.
    const lenta: Quota = { burst: 3, perMinute: 1 };
    for (let i = 0; i < 3; i += 1) {
      await limiter.consume({ key: "contacto-1", quota: lenta });
    }

    // Pasa el minuto del barrido, pero este cubo todavía no está lleno: si se
    // borrara, quien acaba de agotar su cuota volvería a empezar con el cubo
    // lleno y el límite no serviría de nada.
    clock.advance(61_000);
    const decision = await limiter.consume({ key: "contacto-1", quota: lenta });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
    expect(limiter.size).toBe(1);
  });
});
