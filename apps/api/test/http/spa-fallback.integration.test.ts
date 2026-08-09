import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * EL PANEL SERVIDO POR EL MISMO PROCESO (D84).
 *
 * Lo que se prueba no es que un fichero estático se descargue: es la frontera.
 * Un fallo aquí no da error, da algo peor —`/api/leadz` devolviendo el
 * `index.html` con un 200 y el navegador intentando parsearlo como JSON— y el
 * error real queda enterrado bajo un fallo de parseo que no lleva a ningún
 * sitio.
 *
 * Se monta un panel de mentira en una carpeta temporal en vez de compilar el de
 * verdad: lo que se ejerce es el enrutado, no Vite.
 */

const HTML = "<!doctype html><title>Panel</title><div id=root></div>";

describe("El panel servido por la API", () => {
  let webRoot: string;
  let context: ApplicationContext;

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), "agentinmobi-web-"));
    writeFileSync(join(webRoot, "index.html"), HTML);
    writeFileSync(join(webRoot, "app-abc123.js"), "console.log('bundle')");

    context = await withApplication({ WEB_ROOT: webRoot });
  });

  afterAll(async () => {
    await context.stop();
    rmSync(webRoot, { recursive: true, force: true });
  });

  const get = (url: string, accept = "text/html,application/xhtml+xml") =>
    context.server.inject({ method: "GET", url, headers: { accept } });

  it("una ruta del navegador recibe el panel, no un 404", async () => {
    // `/leads` no es un fichero ni una ruta del servidor: la resuelve React
    // Router en cuanto tiene el index.html.
    const response = await get("/leads");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("id=root");
  });

  it("una ruta de API que no existe sigue devolviendo JSON", async () => {
    /*
     * El caso que justifica el test. Sin la lista de prefijos, esto respondería
     * el index.html con un 200 y el fallo real —una ruta mal escrita— sería
     * invisible.
     */
    const response = await get("/api/leadz");

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("NOT_FOUND");
  });

  it("una llamada de datos a una ruta inexistente tampoco recibe HTML", async () => {
    // Sin `Accept: text/html` no es una navegación: es `fetch` pidiendo datos.
    const response = await get("/cualquier-cosa", "application/json");

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("las rutas reales de la API siguen mandando por delante del panel", async () => {
    const response = await get("/api/settings", "application/json");

    // 401 y no 404: la ruta existe, lo que falta es la sesión.
    expect(response.statusCode).toBe(401);
  });

  it("las sondas de salud no las tapa el panel", async () => {
    const response = await get("/health/live");

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("ok");
  });

  it("los bundles con hash se cachean; el index.html nunca", async () => {
    /*
     * El index.html lleva las referencias a los bundles con hash. Si se
     * cacheara, un despliegue nuevo dejaría navegadores pidiendo ficheros que
     * ya no existen — una pantalla en blanco que se arregla sola «al rato».
     */
    const bundle = await get("/app-abc123.js", "*/*");
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers["cache-control"]).toContain("immutable");

    const index = await get("/leads");
    expect(index.headers["cache-control"]).toContain("no-cache");
  });
});

describe("Un WEB_ROOT que no existe", () => {
  it("impide arrancar en vez de servir 404 en todas las pantallas", async () => {
    await expect(withApplication({ WEB_ROOT: join(tmpdir(), "no-existe-agentinmobi") })).rejects.toThrow(
      /index\.html/,
    );
  });
});
