import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withApplication, type ApplicationContext } from "../support/integration-harness";

/**
 * `GET /metrics` sobre la aplicación entera.
 *
 * Lo que solo se puede comprobar aquí: que el hook mide las rutas reales, que
 * el endpoint sale con el `Content-Type` que el recolector espera —si no
 * coincide, Prometheus descarta la respuesta sin decir nada— y que la
 * protección funciona sobre el Fastify que se despliega, no sobre uno montado a
 * mano.
 */
describe("Exposición de métricas (aplicación completa)", () => {
  describe("sin token, como en desarrollo", () => {
    let context: ApplicationContext;

    beforeAll(async () => {
      context = await withApplication();
    });

    afterAll(async () => {
      await context.stop();
    });

    const metrics = () => context.server.inject({ method: "GET", url: "/metrics" });

    it("responde en el formato de exposición de Prometheus", async () => {
      const response = await metrics();

      expect(response.statusCode).toBe(200);
      // La versión del formato es parte del contrato: sin ella algunos
      // recolectores rechazan la respuesta entera.
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.headers["content-type"]).toContain("version=0.0.4");
    });

    it("dice qué versión corre y con qué proveedores", async () => {
      const body = (await metrics()).body;

      /*
       * `build_info` vale siempre 1 y toda la información está en las
       * etiquetas. Es la primera pregunta de cualquier incidencia: qué hay
       * desplegado exactamente.
       */
      expect(body).toMatch(/agentinmobi_build_info\{[^}]*environment="test"[^}]*\} 1/);
      expect(body).toMatch(/agentinmobi_build_info\{[^}]*llm_provider="mock"[^}]*\} 1/);
    });

    it("mide las peticiones por el PATRÓN de ruta, nunca por la URL", async () => {
      await context.server.inject({ method: "GET", url: "/health/live" });
      await context.server.inject({ method: "GET", url: "/health/live" });

      const body = (await metrics()).body;

      expect(body).toContain(
        'agentinmobi_http_requests_total{method="GET",route="/health/live",status="2xx"} 2',
      );
      expect(body).toContain(
        'agentinmobi_http_request_duration_seconds_count{method="GET",route="/health/live"} 2',
      );
    });

    it("agrupa las rutas inexistentes en vez de crear una serie por cada una", async () => {
      for (let i = 0; i < 5; i += 1) {
        await context.server.inject({ method: "GET", url: `/no-existe-${String(i)}` });
      }

      const series = (await metrics()).body
        .split("\n")
        .filter((line) => line.startsWith("agentinmobi_http_requests_total{") && line.includes("4xx"));

      /*
       * Un escaneo de rutas al azar es la forma más fácil de inflar la
       * cardinalidad desde fuera. Todas caen en la misma serie (D64).
       */
      expect(series).toHaveLength(1);
      expect(series[0]).toContain('route="(desconocida)"');
    });

    it("no filtra identificadores en las etiquetas", async () => {
      const body = (await metrics()).body;

      // Ninguna etiqueta puede llevar un UUID: sería una serie por entidad.
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    });
  });

  describe("con token, como en producción", () => {
    let context: ApplicationContext;
    const TOKEN = "un-token-de-pruebas-suficientemente-largo";

    beforeAll(async () => {
      context = await withApplication({ METRICS_TOKEN: TOKEN });
    });

    afterAll(async () => {
      await context.stop();
    });

    it("sin credencial responde 404, no 401", async () => {
      const response = await context.server.inject({ method: "GET", url: "/metrics" });

      /*
       * 404 y no 401 a propósito: un 401 confirma que el endpoint existe, y lo
       * que se expone —versión desplegada, gasto acumulado, mapa de rutas— es
       * reconocimiento gratis para quien lo esté buscando.
       */
      expect(response.statusCode).toBe(404);
    });

    it("con la credencial correcta expone las métricas", async () => {
      const response = await context.server.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("agentinmobi_build_info");
    });
  });

  describe("desactivadas", () => {
    let context: ApplicationContext;

    beforeAll(async () => {
      context = await withApplication({ METRICS_ENABLED: "false" });
    });

    afterAll(async () => {
      await context.stop();
    });

    it("la ruta no existe", async () => {
      const response = await context.server.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(404);
    });
  });
});
