import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * BACK-OFFICE POR HTTP, de punta a punta.
 *
 * Se arranca la aplicación entera —contenedor de DI, los ocho módulos, el
 * outbox, los plugins de Fastify— y se le inyectan peticiones. No hay dobles:
 * la sesión se valida contra Postgres, el `TenantContext` lo fija el guardia
 * real y los errores los traduce el manejador real.
 *
 * Es la capa que ningún test unitario tocaba: hasta ahora, que `/api/inbox`
 * exigiera sesión solo se sabía leyendo el código.
 */

/** Valor de la cookie de sesión que devolvió una respuesta, si la puso. */
const sessionCookie = (response: LightMyRequestResponse): string => {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const cookie = list.find((value) => value.startsWith("agentinmobi_session="));
  return cookie ? (cookie.split(";")[0] ?? "") : "";
};

describe("Back-office por HTTP (aplicación completa)", () => {
  let context: ApplicationContext;
  let tenant: SeededTenant;

  const login = (overrides: Partial<Record<"tenantSlug" | "email" | "password", string>> = {}) =>
    context.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        tenantSlug: overrides.tenantSlug ?? tenant.slug,
        email: overrides.email ?? tenant.email,
        password: overrides.password ?? tenant.password,
      },
    });

  beforeAll(async () => {
    context = await withApplication();
  });

  afterAll(async () => {
    await context.stop();
  });

  beforeEach(async () => {
    await context.reset();
    tenant = await seedTenant(context.app.cradle, { slug: "alfa-propiedades" });
  });

  describe("acceso", () => {
    it("entrega una cookie httpOnly y nunca el token en el cuerpo", async () => {
      const response = await login();

      expect(response.statusCode).toBe(200);

      const raw = response.headers["set-cookie"];
      const cookie = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");

      /*
       * El cuerpo dice QUIÉN eres, no con qué lo demuestras. Si el token
       * apareciera aquí, cualquier XSS podría leerlo del estado de la
       * aplicación — que es justo lo que evita la cookie httpOnly.
       */
      const body = response.json<Record<string, unknown>>();
      expect(JSON.stringify(body)).not.toContain("token");
      expect(body["user"]).toMatchObject({ email: tenant.email });
    });

    it("da el mismo error si el usuario no existe que si la contraseña es incorrecta", async () => {
      const inexistente = await login({ email: "nadie@alfa-propiedades.co" });
      const equivocada = await login({ password: "no-es-esta" });

      expect(inexistente.statusCode).toBe(401);
      expect(equivocada.statusCode).toBe(401);

      // Se compara el error, no el `correlationId`: ese cambia en cada
      // petición a propósito, para poder seguir una en los logs.
      const sinTraza = (response: LightMyRequestResponse) => {
        const { code, message } = response.json<{
          error: { code: string; message: string };
        }>().error;
        return { code, message };
      };

      // Mensajes distintos serían un oráculo para averiguar qué correos existen.
      expect(sinTraza(inexistente)).toEqual(sinTraza(equivocada));
    });

    it("el mismo correo en otra inmobiliaria no sirve para entrar", async () => {
      const otra = await seedTenant(context.app.cradle, { slug: "beta-inmuebles" });

      const cruzado = await login({ tenantSlug: otra.slug });

      // El correo identifica a la persona DENTRO de una inmobiliaria, no
      // globalmente. Sin esto, un asesor de una entraría en la otra.
      expect(cruzado.statusCode).toBe(401);
    });
  });

  describe("rutas protegidas", () => {
    it("sin cookie responde 401 y no filtra nada", async () => {
      for (const url of ["/api/auth/me", "/api/inbox", "/api/leads", "/api/settings"]) {
        const response = await context.server.inject({ method: "GET", url });
        expect(response.statusCode, url).toBe(401);
      }
    });

    it("con una cookie inventada responde 401", async () => {
      const response = await context.server.inject({
        method: "GET",
        url: "/api/inbox",
        headers: { cookie: "agentinmobi_session=token-que-me-acabo-de-inventar" },
      });

      expect(response.statusCode).toBe(401);
    });

    it("con sesión válida el tenant sale de la cookie, no de la petición", async () => {
      const cookie = sessionCookie(await login());
      expect(cookie).not.toBe("");

      const inbox = await context.server.inject({
        method: "GET",
        url: "/api/inbox",
        headers: { cookie },
      });

      expect(inbox.statusCode).toBe(200);
      expect(inbox.json<{ items: unknown[] }>().items).toEqual([]);
    });
  });

  describe("aislamiento a través del HTTP", () => {
    it("la sesión de una inmobiliaria no alcanza los datos de la otra", async () => {
      const beta = await seedTenant(context.app.cradle, { slug: "beta-inmuebles" });

      // Beta crea una colección de conocimiento.
      const cookieBeta = sessionCookie(
        await context.server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { tenantSlug: beta.slug, email: beta.email, password: beta.password },
        }),
      );

      const creada = await context.server.inject({
        method: "POST",
        url: "/api/knowledge/collections",
        headers: { cookie: cookieBeta },
        payload: { slug: "tarifas", name: "Tarifas" },
      });
      expect(creada.statusCode).toBe(201);
      const collectionId = creada.json<{ id: string }>().id;

      // Alfa pide esa colección por su id exacto.
      const cookieAlfa = sessionCookie(await login());
      const intento = await context.server.inject({
        method: "GET",
        url: `/api/knowledge/collections/${collectionId}/documents`,
        headers: { cookie: cookieAlfa },
      });

      expect(intento.statusCode).toBe(404);

      // Y en su propio listado no aparece.
      const suyas = await context.server.inject({
        method: "GET",
        url: "/api/knowledge/collections",
        headers: { cookie: cookieAlfa },
      });
      expect(suyas.json<{ items: unknown[] }>().items).toEqual([]);
    });
  });

  describe("cierre de sesión", () => {
    it("revoca la sesión al instante, no cuando caduque", async () => {
      const cookie = sessionCookie(await login());

      const antes = await context.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      expect(antes.statusCode).toBe(200);

      await context.server.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });

      /*
       * Esta es la razón de no usar JWT (D34): con un token firmado, la misma
       * cookie seguiría siendo válida hasta su caducidad aunque el asesor
       * hubiera cerrado sesión o hubiera sido dado de baja.
       */
      const despues = await context.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      expect(despues.statusCode).toBe(401);
    });
  });

  describe("configuración", () => {
    it("guarda solo lo que llega y lo devuelve ya aplicado", async () => {
      const cookie = sessionCookie(await login());

      const original = await context.server.inject({
        method: "GET",
        url: "/api/settings",
        headers: { cookie },
      });
      const nombre = original.json<{ agent: { agentDisplayName: string } }>().agent
        .agentDisplayName;

      const guardado = await context.server.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie },
        payload: { tone: "FORMAL" },
      });

      expect(guardado.statusCode).toBe(200);
      const agente = guardado.json<{ agent: { tone: string; agentDisplayName: string } }>().agent;
      expect(agente.tone).toBe("FORMAL");
      // Nadie tocó el nombre: una actualización parcial no debe arrastrarlo.
      expect(agente.agentDisplayName).toBe(nombre);
    });

    it("rechaza un horario imposible sin dejar rastro", async () => {
      const cookie = sessionCookie(await login());

      const response = await context.server.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie },
        payload: { businessHours: { days: [1], from: "99:99", to: "18:00" } },
      });

      expect(response.statusCode).toBe(400);

      const despues = await context.server.inject({
        method: "GET",
        url: "/api/settings",
        headers: { cookie },
      });
      expect(despues.json<{ agent: { businessHours?: unknown } }>().agent.businessHours)
        .toBeUndefined();
    });
  });
});
