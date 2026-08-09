import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SecretBox } from "../../src/platform/crypto/secret-box";
import { isOk } from "../../src/platform/result/result";
import { seedTenant, type SeededTenant } from "../support/fixtures";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * CONECTAR WHATSAPP DESDE EL PANEL, de punta a punta.
 *
 * Es el paso de puesta en marcha del producto, y hasta ahora solo existía como
 * comando en el servidor. Lo que se prueba aquí no es que el formulario
 * envíe: es que el token acaba CIFRADO en la base, que la comprobación contra
 * el proveedor sale de verdad por la red, y que un proveedor que no responde
 * NO impide conectar (D80).
 *
 * La Graph API se sustituye por un servidor HTTP real en un puerto efímero, no
 * por un doble del cliente. Así se ejerce la petición que se construye —ruta,
 * método y cabecera de autorización—, que es justo lo único que damos por
 * supuesto de Meta.
 */

interface GraphStub {
  readonly url: string;
  readonly requests: { method: string; path: string; authorization: string }[];
  status: number;
  close(): Promise<void>;
}

const startGraphStub = async (): Promise<GraphStub> => {
  const requests: GraphStub["requests"] = [];
  const state = { status: 200 };

  const server: Server = createServer((request: IncomingMessage, response) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization ?? "",
    });

    response.writeHead(state.status, { "content-type": "application/json" });
    response.end(
      state.status === 200
        ? "{}"
        : JSON.stringify({ error: { message: "Token no válido para este número", code: 190 } }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
};

const sessionCookie = (response: LightMyRequestResponse): string => {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const cookie = list.find((value) => value.startsWith("agentinmobi_session="));
  return cookie ? (cookie.split(";")[0] ?? "") : "";
};

describe("Conectar WhatsApp desde el back-office", () => {
  let graph: GraphStub;
  let context: ApplicationContext;
  let tenant: SeededTenant;
  let cookie: string;

  const connect = (
    payload: Record<string, unknown> = {
      phoneNumberId: "109876543210987",
      displayName: "Comercial Bogotá",
      accessToken: "EAAG-token-de-pruebas",
    },
  ) =>
    context.server.inject({
      method: "POST",
      url: "/api/channels/whatsapp",
      headers: { cookie },
      payload,
    });

  beforeAll(async () => {
    graph = await startGraphStub();
    context = await withApplication({
      // Sin estos dos, el canal ni siquiera se registra (D31).
      WHATSAPP_APP_SECRET: "secreto-de-pruebas",
      WHATSAPP_VERIFY_TOKEN: "verify-de-pruebas",
      WHATSAPP_GRAPH_URL: graph.url,
      WHATSAPP_TIMEOUT_MS: "2000",
    });
  });

  afterAll(async () => {
    await context.stop();
    await graph.close();
  });

  beforeEach(async () => {
    await context.reset();
    graph.status = 200;
    graph.requests.length = 0;
    tenant = await seedTenant(context.app.cradle, { slug: "conecta-propiedades" });

    const login = await context.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { tenantSlug: tenant.slug, email: tenant.email, password: tenant.password },
    });
    cookie = sessionCookie(login);
  });

  it("guarda el número y confirma contra el proveedor", async () => {
    const response = await connect();

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      account: { externalId: string; isActive: boolean };
      verified: boolean;
    }>();
    expect(body.verified).toBe(true);
    expect(body.account.externalId).toBe("109876543210987");
    expect(body.account.isActive).toBe(true);

    // La comprobación LEE el número; no manda un mensaje que le llegaría a
    // alguien y se facturaría.
    expect(graph.requests).toHaveLength(1);
    expect(graph.requests[0]?.method).toBe("GET");
    expect(graph.requests[0]?.path).toContain("/109876543210987");
    expect(graph.requests[0]?.authorization).toBe("Bearer EAAG-token-de-pruebas");
  });

  it("el token acaba CIFRADO: no aparece en claro en la base", async () => {
    await connect();

    const row = await context.sql((tx) =>
      tx.channelAccount.findFirst({
        where: { externalId: "109876543210987" },
        select: { id: true, credentials: true },
      }),
    );

    const blob = Buffer.from(row?.credentials ?? new Uint8Array());
    expect(blob.length).toBeGreaterThan(0);
    expect(blob.toString("utf8")).not.toContain("EAAG-token-de-pruebas");

    // Y descifra a lo que se guardó: cifrar mal también «oculta» el token.
    const box = new SecretBox(context.app.cradle.config.security.encryptionKey);
    const decrypted = box.decryptJson(blob);
    expect(isOk(decrypted) && decrypted.value["accessToken"]).toBe("EAAG-token-de-pruebas");
  });

  it("el token NUNCA vuelve al navegador", async () => {
    const response = await connect();

    expect(response.body).not.toContain("EAAG-token-de-pruebas");

    const listed = await context.server.inject({
      method: "GET",
      url: "/api/channels/accounts",
      headers: { cookie },
    });
    expect(listed.body).not.toContain("EAAG-token-de-pruebas");
  });

  it("si el proveedor rechaza el token, SE GUARDA IGUAL y se avisa (D80)", async () => {
    graph.status = 401;

    const response = await connect();

    expect(response.statusCode).toBe(200);
    const body = response.json<{ verified: boolean; verificationMessage?: string }>();
    expect(body.verified).toBe(false);
    expect(body.verificationMessage).toBeDefined();

    // Guardado de verdad: aparece en el listado.
    const listed = await context.server.inject({
      method: "GET",
      url: "/api/channels/accounts",
      headers: { cookie },
    });
    const items = listed.json<{ items: { externalId: string }[] }>().items;
    expect(items.some((item) => item.externalId === "109876543210987")).toBe(true);
  });

  it("volver a conectar el mismo número rota el token sin duplicar la línea", async () => {
    await connect();
    await connect({
      phoneNumberId: "109876543210987",
      displayName: "Comercial Bogotá",
      accessToken: "EAAG-token-rotado",
    });

    const rows = await context.sql((tx) =>
      tx.channelAccount.findMany({ where: { externalId: "109876543210987" } }),
    );
    expect(rows).toHaveLength(1);

    const box = new SecretBox(context.app.cradle.config.security.encryptionKey);
    const decrypted = box.decryptJson(Buffer.from(rows[0]?.credentials ?? new Uint8Array()));
    expect(isOk(decrypted) && decrypted.value["accessToken"]).toBe("EAAG-token-rotado");
  });

  it("el mismo número en otra inmobiliaria es un conflicto", async () => {
    await connect();

    const otra = await seedTenant(context.app.cradle, { slug: "rival-propiedades" });
    const login = await context.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { tenantSlug: otra.slug, email: otra.email, password: otra.password },
    });
    cookie = sessionCookie(login);

    const response = await connect();

    // 409: el par (canal, id externo) es lo que resuelve el tenant de cada
    // mensaje entrante. Permitirlo dos veces mandaría conversaciones de una
    // inmobiliaria a la otra.
    expect(response.statusCode).toBe(409);
  });

  it("sin sesión no se conecta nada", async () => {
    cookie = "";

    const response = await connect();

    expect(response.statusCode).toBe(401);
  });

  it("el listado dice qué canales sabe operar este despliegue", async () => {
    const listed = await context.server.inject({
      method: "GET",
      url: "/api/channels/accounts",
      headers: { cookie },
    });

    expect(listed.json<{ available: string[] }>().available).toContain("WHATSAPP");
  });
});
