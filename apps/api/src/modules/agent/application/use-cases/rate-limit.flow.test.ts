import { describe, expect, it } from "vitest";
import { isOk } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { createHarness, type Harness } from "../../testing/agent-turn.harness";

/**
 * LÍMITE DE RITMO POR CONTACTO, de punta a punta.
 *
 * La aritmética del cubo de fichas ya está probada aparte. Lo que se comprueba
 * aquí es la decisión de producto: qué le pasa a un contacto que no para, y qué
 * NO le pasa a los demás.
 *
 * Conviene recordar contra qué protege esto y contra qué no. Las ráfagas cortas
 * —alguien que manda cinco mensajes seguidos mientras piensa— ya las une el
 * debounce de turnos: eso es un turno, no cinco. Lo que se corta aquí es lo
 * sostenido: un número que insiste durante horas.
 */

let turnCounter = 0;

const runTurn = (harness: Harness, text: string, contactId = "ct1") => {
  turnCounter += 1;
  harness.conversations.recordContact(text);

  return TenantContext.run({ tenantId: "t1", correlationId: "corr-1", source: "test" }, () =>
    harness.runTurn.execute({
      conversationId: "c1",
      turnId: `turn-${String(turnCounter)}`,
      contactId,
      text,
      correlationId: "corr-1",
    }),
  );
};

/** Ráfaga de dos turnos y nada más: el tercero ya se pasa. */
const APRETADA = { burst: 2, perMinute: 60 };

describe("Límite de ritmo por contacto", () => {
  it("atiende la ráfaga tolerada y omite el turno que se pasa", async () => {
    const harness = createHarness({ turnQuota: APRETADA });

    expect((await runTurn(harness, "hola")).ok).toBe(true);
    await runTurn(harness, "sigues ahí");

    const tercero = await runTurn(harness, "hola?");

    expect(isOk(tercero)).toBe(true);
    if (!isOk(tercero)) return;
    expect(tercero.value.status).toBe("SKIPPED");
  });

  it("el turno omitido no llega al modelo ni deja ejecución", async () => {
    const harness = createHarness({ turnQuota: APRETADA });
    await runTurn(harness, "hola");
    await runTurn(harness, "sigues ahí");

    const antes = harness.runs.runs.length;
    await runTurn(harness, "hola?");

    /*
     * La razón de ser del límite: un turno que no se ejecuta no cuesta tokens.
     * Si esto creciera, el corte estaría puesto después de gastar y no serviría
     * para nada.
     */
    expect(harness.runs.runs.length).toBe(antes);
    expect((await harness.usage.spendIn("2026-07")).turns).toBe(antes);
  });

  it("avisa al cliente una sola vez, no en cada mensaje bloqueado", async () => {
    const harness = createHarness({ turnQuota: APRETADA });
    await runTurn(harness, "hola");
    await runTurn(harness, "sigues ahí");

    const antes = harness.conversations.replies.length;
    await runTurn(harness, "hola?");
    await runTurn(harness, "hola??");
    await runTurn(harness, "hola???");

    const nuevos = harness.conversations.replies.slice(antes);

    // Uno solo. Repetirlo en cada mensaje sería duplicar la inundación por el
    // otro lado — y en WhatsApp, además, pagar por hacerlo.
    expect(nuevos).toHaveLength(1);
    // Habla la plataforma, no el agente: el agente no ha ejecutado nada.
    expect(nuevos[0]?.authorType).toBe("SYSTEM");
  });

  it("el contacto pesado no afecta a los demás de la misma inmobiliaria", async () => {
    const harness = createHarness({ turnQuota: APRETADA });
    await runTurn(harness, "hola");
    await runTurn(harness, "sigues ahí");
    await runTurn(harness, "hola?");

    // Otro cliente de la misma inmobiliaria, con su propio cubo.
    const otro = await runTurn(harness, "busco apartamento", "ct2");

    expect(isOk(otro)).toBe(true);
    if (!isOk(otro)) return;
    expect(otro.value.status).toBe("COMPLETED");
  });

  it("vuelve a atender cuando pasa el tiempo", async () => {
    const harness = createHarness({ turnQuota: APRETADA });
    await runTurn(harness, "hola");
    await runTurn(harness, "sigues ahí");

    const bloqueado = await runTurn(harness, "hola?");
    expect(isOk(bloqueado) && bloqueado.value.status).toBe("SKIPPED");

    // No es una expulsión: es un compás de espera. Una ficha por segundo.
    harness.clock.advance(1_000);
    const despues = await runTurn(harness, "¿sigues?");

    expect(isOk(despues)).toBe(true);
    if (!isOk(despues)) return;
    expect(despues.value.status).toBe("COMPLETED");
  });

  it("sin cuota configurada no limita nunca", async () => {
    const harness = createHarness({ turnQuota: { burst: 0, perMinute: 0 } });

    for (let i = 0; i < 8; i += 1) {
      const result = await runTurn(harness, "hola");
      expect(isOk(result) && result.value.status).toBe("COMPLETED");
    }
  });

  it("si el limitador revienta, el cliente sigue siendo atendido", async () => {
    const harness = createHarness({ turnQuota: APRETADA });

    /*
     * No poder medir el ritmo es un problema nuestro. Convertirlo en un cliente
     * sin respuesta sería un problema suyo, y mucho peor: la protección no
     * puede ser más dañina que aquello de lo que protege.
     */
    harness.rateLimiter.breakWith(new Error("Redis caído"));

    const result = await runTurn(harness, "hola");

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe("COMPLETED");
  });
});
