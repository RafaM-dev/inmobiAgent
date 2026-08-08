import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * LÍMITE DE RITMO POR INMOBILIARIA, por HTTP y de punta a punta.
 *
 * Lo que aquí se prueba y en ningún otro sitio: que el corte OCURRE en la ruta
 * real, que sale con el estado correcto y con la cabecera que hace que el
 * proveedor vuelva. Un test unitario puede demostrar que el caso de uso decide
 * bien; solo este demuestra que esa decisión llega al cable.
 *
 * El límite se pone apretadísimo por configuración —tres mensajes de ráfaga—
 * porque el objetivo no es medir el número, sino el comportamiento en el borde.
 */
describe("Límite de ritmo por inmobiliaria (HTTP real)", () => {
  let context: ApplicationContext;
  let primera: SeededTenant;
  let segunda: SeededTenant;

  const enviar = (tenant: SeededTenant, text: string) =>
    context.server.inject({
      method: "POST",
      url: `/api/channels/CONSOLE/${tenant.consoleAccountExternalId}/messages`,
      payload: { from: "+573001112233", displayName: "Cliente", text },
    });

  beforeAll(async () => {
    context = await withApplication({
      RATE_LIMIT_TENANT_MESSAGES_BURST: "3",
      RATE_LIMIT_TENANT_MESSAGES_PER_MINUTE: "60",
    });
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    primera = await seedTenant(context.app.cradle, { slug: "alfa-propiedades" });
    segunda = await seedTenant(context.app.cradle, { slug: "beta-propiedades" });
  });

  it("acepta la ráfaga tolerada y corta la siguiente con 429", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await enviar(primera, `mensaje ${String(i)}`)).statusCode).toBe(202);
    }

    const cortado = await enviar(primera, "uno más");

    expect(cortado.statusCode).toBe(429);
    expect(cortado.json<{ error: { code: string } }>().error.code).toBe("RATE_LIMITED");
  });

  it("dice cuándo volver, que es lo que convierte el corte en un aplazo", async () => {
    for (let i = 0; i < 3; i += 1) await enviar(primera, `mensaje ${String(i)}`);

    const cortado = await enviar(primera, "uno más");

    /*
     * Sin `Retry-After` el proveedor decide por su cuenta cuándo reintentar —o
     * si reintentar— y el mensaje del cliente puede no llegar nunca. Con ella,
     * el 429 aplaza la conversación en vez de romperla.
     */
    const retryAfter = Number(cortado.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("el límite es de cada inmobiliaria, no de todas juntas", async () => {
    for (let i = 0; i < 4; i += 1) await enviar(primera, `mensaje ${String(i)}`);

    /*
     * La razón por la que el límite NO puede vivir en el servidor HTTP: por la
     * IP de un proveedor entran los mensajes de todas las inmobiliarias, y
     * cortar por IP castigaría a las demás por el bucle de una. El tenant solo
     * se conoce después de resolver la cuenta de canal.
     */
    expect((await enviar(segunda, "hola")).statusCode).toBe(202);
  });

  it("nada se pierde: el mensaje rechazado entra al reintentarlo", async () => {
    for (let i = 0; i < 3; i += 1) await enviar(primera, `mensaje ${String(i)}`);

    const cortado = await enviar(primera, "el que se cayó");
    expect(cortado.statusCode).toBe(429);

    // Un segundo de reposición a 60 por minuto es exactamente una ficha.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const reintento = await enviar(primera, "el que se cayó");
    expect(reintento.statusCode).toBe(202);
  });
});
