import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, request, requestVoid } from "./client";

/**
 * CLIENTE HTTP DEL PANEL.
 *
 * Es la costura donde se detecta que el backend y el frontend han dejado de
 * hablar el mismo idioma, y por eso merece la primera prueba del panel: si esto
 * falla en silencio, el error aparece tres componentes más abajo como un
 * `undefined is not a function` y nadie sabe de dónde vino.
 */

const persona = z.object({ id: z.string(), nombre: z.string() });

/** `fetch` de mentira. Devuelve lo que se le diga y anota cómo lo llamaron. */
const fakeFetch = (response: {
  status?: number;
  body?: unknown;
  /** Para simular una respuesta que no es JSON. */
  raw?: string;
}) => {
  const spy = vi.fn().mockResolvedValue({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    json: () =>
      response.raw === undefined
        ? Promise.resolve(response.body)
        : Promise.reject(new Error("no es JSON")),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("Cliente HTTP", () => {
  it("devuelve los datos validados contra el contrato", async () => {
    fakeFetch({ body: { id: "1", nombre: "Ana" } });

    const result = await request("/api/personas/1", persona);

    expect(result).toEqual({ id: "1", nombre: "Ana" });
  });

  it("una respuesta que no cumple el contrato falla AQUÍ, con nombre y campo", async () => {
    fakeFetch({ body: { id: "1" } });

    /*
     * El fallo que esto atrapa: el backend quita un campo, el frontend no se
     * entera y la pantalla revienta más adelante con un mensaje que no dice
     * nada. Aquí el error señala la ruta y el campo exactos.
     */
    await expect(request("/api/personas/1", persona)).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
    });

    await expect(request("/api/personas/1", persona)).rejects.toThrow(/nombre/);
    await expect(request("/api/personas/1", persona)).rejects.toThrow(/\/api\/personas\/1/);
  });

  it("traduce el error de la API conservando su código y su correlación", async () => {
    fakeFetch({
      status: 409,
      body: {
        error: { code: "CONFLICT", message: "Ya existe", correlationId: "corr-42" },
      },
    });

    const error = await request("/api/personas", persona).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Ya existe",
      // Sin esto, un usuario que reporta un fallo no puede dar nada que sirva
      // para encontrarlo en los logs.
      correlationId: "corr-42",
    });
  });

  it("un error sin cuerpo legible sigue siendo un ApiError con su estado", async () => {
    fakeFetch({ status: 502, raw: "<html>Bad Gateway</html>" });

    const error = await request("/api/personas", persona).catch((cause: unknown) => cause);

    // Un proxy o un balanceador contestan HTML. No puede tumbar el panel.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "UNKNOWN" });
  });

  it("reconoce la sesión caducada, que es el único error con tratamiento propio", async () => {
    fakeFetch({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "No autenticado" } } });

    const error = await request("/api/auth/me", persona).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isUnauthorized).toBe(true);
  });

  it("envía siempre la cookie del mismo origen y nunca una cabecera de token", async () => {
    const spy = fakeFetch({ body: { id: "1", nombre: "Ana" } });

    await request("/api/personas/1", persona);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    /*
     * La sesión viaja en una cookie `httpOnly` que este código NO puede leer.
     * Si algún día apareciera aquí un `Authorization`, significaría que alguien
     * volvió a guardar un token en el navegador — justo lo que un XSS roba.
     */
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toBeUndefined();
  });

  it("serializa el cuerpo como JSON y lo anuncia", async () => {
    const spy = fakeFetch({ body: { id: "1", nombre: "Ana" } });

    await request("/api/personas", persona, { method: "POST", body: { nombre: "Ana" } });

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"nombre":"Ana"}');
  });

  it("propaga la señal de cancelación", async () => {
    const spy = fakeFetch({ body: { id: "1", nombre: "Ana" } });
    const controller = new AbortController();

    await request("/api/personas/1", persona, { signal: controller.signal });

    // Sin esto, una petición de una pantalla que el asesor ya cerró seguiría
    // viva y escribiría estado sobre un componente desmontado.
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("una respuesta sin cuerpo no intenta validarse", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error("sin cuerpo")) });
    vi.stubGlobal("fetch", spy);

    // `logout` devuelve 204: pedirle JSON reventaría.
    await expect(requestVoid("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
