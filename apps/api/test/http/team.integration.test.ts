import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryNotifier } from "../../src/platform/notifications/in-memory-notifier";
import { seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * EQUIPO Y RECUPERACIÓN DE CUENTA, de punta a punta.
 *
 * Es la superficie con la que se da acceso al panel, así que lo que se prueba
 * aquí no es que el formulario funcione: es que **nadie pueda concederse más de
 * lo que tiene** y que los caminos públicos —invitación y recuperación— no
 * filtren quién trabaja en qué inmobiliaria.
 */

const sessionCookie = (response: LightMyRequestResponse): string => {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const cookie = list.find((value) => value.startsWith("agentinmobi_session="));
  return cookie ? (cookie.split(";")[0] ?? "") : "";
};

/** El enlace que viajó en el correo. Es lo que recibiría la persona invitada. */
const tokenFromEmail = (body: string): string =>
  new URL(/https?:\/\/\S+/.exec(body)?.[0] ?? "http://x/?token=").searchParams.get("token") ?? "";

describe("Equipo y recuperación de cuenta", () => {
  let context: ApplicationContext;
  let tenant: SeededTenant;
  let ownerCookie: string;
  let notifier: InMemoryNotifier;

  const login = (email: string, password: string, slug = tenant.slug) =>
    context.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { tenantSlug: slug, email, password },
    });

  const invite = (payload: Record<string, unknown>, cookie = ownerCookie) =>
    context.server.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie },
      payload,
    });

  beforeAll(async () => {
    // Se sustituye SOLO el notificador, para poder leer el enlace que viaja en
    // el correo. Todo lo demás —HTTP, sesiones, base de datos— es lo real.
    notifier = new InMemoryNotifier();
    context = await withApplication({}, { notifier });
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    notifier.clear();
    tenant = await seedTenant(context.app.cradle, { slug: "equipo-propiedades" });
    ownerCookie = sessionCookie(await login(tenant.email, tenant.password));
  });

  /* ------------------------------------------------------------- invitar */

  it("invitar crea la cuenta y manda un enlace", async () => {
    const response = await invite({
      email: "nueva@equipo-propiedades.co",
      displayName: "Asesora Nueva",
      role: "AGENT",
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { status: string }; delivered: boolean }>();
    expect(body.user.status).toBe("INVITED");
    expect(body.delivered).toBe(true);
    expect(notifier.last?.to).toBe("nueva@equipo-propiedades.co");
  });

  it("quien está invitado NO puede entrar todavía", async () => {
    await invite({ email: "nueva@equipo-propiedades.co", displayName: "Nueva", role: "AGENT" });

    // Sin contraseña no hay acceso, y tampoco lo habría acertándola: el estado
    // INVITED cierra la puerta por sí solo.
    const attempt = await login("nueva@equipo-propiedades.co", "una-contrasena-cualquiera");
    expect(attempt.statusCode).toBe(401);
  });

  it("el ciclo completo: invitar, canjear el enlace y entrar", async () => {
    await invite({ email: "nueva@equipo-propiedades.co", displayName: "Nueva", role: "AGENT" });

    const redeemed = await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token: tokenFromEmail(notifier.last?.body ?? ""), password: "contrasena-larga-2026" },
    });

    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json<{ email: string }>().email).toBe("nueva@equipo-propiedades.co");

    // Canjear NO abre sesión: el enlace ha viajado por correo, así que se exige
    // escribir la contraseña una vez.
    expect(sessionCookie(redeemed)).toBe("");

    const entrada = await login("nueva@equipo-propiedades.co", "contrasena-larga-2026");
    expect(entrada.statusCode).toBe(200);
  });

  it("un enlace no se puede usar dos veces", async () => {
    await invite({ email: "nueva@equipo-propiedades.co", displayName: "Nueva", role: "AGENT" });
    const token = tokenFromEmail(notifier.last?.body ?? "");

    const redeem = () =>
      context.server.inject({
        method: "POST",
        url: "/api/auth/redeem",
        payload: { token, password: "contrasena-larga-2026" },
      });

    expect((await redeem()).statusCode).toBe(200);
    expect((await redeem()).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("una contraseña corta no quema el enlace", async () => {
    // Quien se equivoca escribiéndola tiene que poder reintentar con el mismo
    // correo, no pedir otro.
    await invite({ email: "nueva@equipo-propiedades.co", displayName: "Nueva", role: "AGENT" });
    const token = tokenFromEmail(notifier.last?.body ?? "");

    const corta = await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token, password: "corta" },
    });
    expect(corta.statusCode).toBeGreaterThanOrEqual(400);

    const buena = await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token, password: "contrasena-larga-2026" },
    });
    expect(buena.statusCode).toBe(200);
  });

  /* ---------------------------------------------------------- privilegios */

  it("un ADMIN no puede crear a otro ADMIN ni a un OWNER", async () => {
    /*
     * La regla que sostiene la distinción entre los dos roles. Si un
     * administrador pudiera nombrar administradores, su rol sería en la
     * práctica el de propietario.
     */
    await invite({ email: "admin@equipo-propiedades.co", displayName: "Admin", role: "ADMIN" });
    const token = tokenFromEmail(notifier.last?.body ?? "");
    await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token, password: "contrasena-larga-2026" },
    });
    const adminCookie = sessionCookie(
      await login("admin@equipo-propiedades.co", "contrasena-larga-2026"),
    );

    const intento = await invite(
      { email: "otro@equipo-propiedades.co", displayName: "Otro", role: "ADMIN" },
      adminCookie,
    );

    expect(intento.statusCode).toBe(403);
  });

  it("un AGENT ve el equipo pero no puede tocarlo", async () => {
    const listado = await context.server.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: ownerCookie },
    });
    expect(listado.statusCode).toBe(200);
    expect(listado.json<{ canManage: boolean }>().canManage).toBe(true);

    await invite({ email: "comercial@equipo-propiedades.co", displayName: "Asesor", role: "AGENT" });
    const token = tokenFromEmail(notifier.last?.body ?? "");
    await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token, password: "contrasena-larga-2026" },
    });
    const agentCookie = sessionCookie(
      await login("comercial@equipo-propiedades.co", "contrasena-larga-2026"),
    );

    const suyo = await context.server.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: agentCookie },
    });
    expect(suyo.statusCode).toBe(200);
    expect(suyo.json<{ canManage: boolean }>().canManage).toBe(false);

    const intento = await invite(
      { email: "colado@equipo-propiedades.co", displayName: "Colado", role: "AGENT" },
      agentCookie,
    );
    expect(intento.statusCode).toBe(403);
  });

  it("nadie se desactiva a sí mismo", async () => {
    const yo = await context.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie },
    });
    const userId = yo.json<{ user: { userId: string } }>().user.userId;

    const intento = await context.server.inject({
      method: "PATCH",
      url: `/api/users/${userId}`,
      headers: { cookie: ownerCookie },
      payload: { status: "DISABLED" },
    });

    // Si pudiera, la única persona con acceso se cerraría la puerta y haría
    // falta entrar por consola para abrirla.
    expect(intento.statusCode).toBe(403);
  });

  it("desactivar a alguien le cierra la puerta", async () => {
    await invite({ email: "temporal@equipo-propiedades.co", displayName: "Temporal", role: "AGENT" });
    const token = tokenFromEmail(notifier.last?.body ?? "");
    await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token, password: "contrasena-larga-2026" },
    });
    expect((await login("temporal@equipo-propiedades.co", "contrasena-larga-2026")).statusCode).toBe(
      200,
    );

    const equipo = await context.server.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: ownerCookie },
    });
    const id =
      equipo
        .json<{ items: { id: string; email: string }[] }>()
        .items.find((item) => item.email === "temporal@equipo-propiedades.co")?.id ?? "";

    const baja = await context.server.inject({
      method: "PATCH",
      url: `/api/users/${id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "DISABLED" },
    });
    expect(baja.statusCode).toBe(200);

    expect((await login("temporal@equipo-propiedades.co", "contrasena-larga-2026")).statusCode).toBe(
      401,
    );
  });

  /* -------------------------------------------------------- recuperación */

  it("pedir recuperación responde igual exista o no la cuenta", async () => {
    /*
     * Es la propiedad que impide usar este formulario para averiguar quién
     * trabaja en cada inmobiliaria probando correos uno a uno.
     */
    const existe = await context.server.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { tenantSlug: tenant.slug, email: tenant.email },
    });
    const noExiste = await context.server.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { tenantSlug: tenant.slug, email: "nadie@equipo-propiedades.co" },
    });

    expect(existe.statusCode).toBe(202);
    expect(noExiste.statusCode).toBe(202);
    expect(existe.body).toBe(noExiste.body);
    // Y solo se ha mandado UN correo: al que sí existe.
    expect(notifier.sent).toHaveLength(1);
  });

  it("restablecer la contraseña cierra las sesiones abiertas", async () => {
    /*
     * Lo que da sentido a restablecer. Si se hace porque alguien pudo haber
     * entrado, dejar viva su sesión no arregla nada.
     */
    const antes = await context.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect(antes.statusCode).toBe(200);

    await context.server.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { tenantSlug: tenant.slug, email: tenant.email },
    });
    await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token: tokenFromEmail(notifier.last?.body ?? ""), password: "otra-contrasena-2026" },
    });

    const despues = await context.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect(despues.statusCode).toBe(401);
  });

  it("pedir un enlace nuevo invalida el anterior", async () => {
    const pedir = () =>
      context.server.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { tenantSlug: tenant.slug, email: tenant.email },
      });

    await pedir();
    const primero = tokenFromEmail(notifier.last?.body ?? "");
    await pedir();
    const segundo = tokenFromEmail(notifier.last?.body ?? "");
    expect(primero).not.toBe(segundo);

    // El correo viejo puede haber acabado reenviado o archivado en cualquier
    // sitio: no puede seguir abriendo la cuenta.
    const conElViejo = await context.server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { token: primero, password: "contrasena-larga-2026" },
    });
    expect(conElViejo.statusCode).toBeGreaterThanOrEqual(400);
  });
});
