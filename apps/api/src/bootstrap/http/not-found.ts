import { readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../platform/logging/logger";

/**
 * Qué pasa cuando ninguna ruta coincide.
 *
 * En desarrollo hay dos servidores —Vite en 5173, la API en 3100— y aquí todo
 * 404 es JSON. En producción **el mismo proceso sirve el panel**, y entonces
 * una URL como `/leads` no es un error: es una ruta del navegador que React
 * Router resolverá en cuanto reciba el `index.html`.
 *
 * **D84 — un solo origen, y no es por comodidad.** La cookie de sesión es
 * `SameSite=Lax`, que es lo que la protege de CSRF. Servir el panel desde otro
 * dominio obligaría a `SameSite=None`, debilitando esa protección, o a montar
 * un dominio padre compartido. Con un solo origen la cookie sigue funcionando
 * tal cual, CORS deja de hacer falta en producción, y se despliega una cosa en
 * vez de dos.
 */

export interface NotFoundOptions {
  /**
   * Carpeta del panel ya compilado. Ausente en desarrollo, donde lo sirve Vite.
   *
   * Si viene, la carpeta TIENE que existir: se comprueba al arrancar. Un
   * despliegue que se quede sin panel debe fallar al desplegarse, no responder
   * 404 a los asesores.
   */
  readonly webRoot?: string;
  readonly logger: Logger;
}

/**
 * Prefijos que NUNCA reciben el panel.
 *
 * Sin esta lista, un `GET /api/leadz` mal escrito devolvería el `index.html`
 * con un 200, el navegador intentaría interpretarlo como JSON y el error real
 * —una ruta que no existe— quedaría enterrado bajo un fallo de parseo.
 */
const BACKEND_PREFIXES = ["/api/", "/webhooks/", "/health", "/metrics"];

const isBackendPath = (url: string): boolean =>
  BACKEND_PREFIXES.some((prefix) => url.startsWith(prefix));

/** Una navegación del navegador, no una llamada de datos. */
const wantsHtml = (request: FastifyRequest): boolean =>
  request.method === "GET" && (request.headers.accept ?? "").includes("text/html");

const jsonNotFound = (request: FastifyRequest, reply: FastifyReply): void => {
  void reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
      correlationId: request.correlationId,
    },
  });
};

export const registerNotFound = async (
  app: FastifyInstance,
  options: NotFoundOptions,
): Promise<void> => {
  const { webRoot } = options;

  if (webRoot === undefined) {
    app.setNotFoundHandler(jsonNotFound);
    return;
  }

  /*
   * El `index.html` se lee UNA VEZ, al arrancar, y se sirve desde memoria.
   *
   * Dos motivos, y el segundo es el que importa. El primero: si falta, el
   * proceso no arranca —una imagen construida sin el paso del panel debe fallar
   * al desplegarse, no responder 404 a los asesores en todas las pantallas—.
   *
   * El segundo: así las cabeceras de caché son EXACTAMENTE las que se escriben
   * aquí. Con `sendFile` las pone el plugin estático a partir de su `maxAge`, y
   * el `index.html` acababa marcado `immutable` por un año. Como lleva dentro
   * las referencias a los bundles con hash, el siguiente despliegue dejaría
   * navegadores pidiendo ficheros que ya no existen: una pantalla en blanco que
   * «se arregla sola» al cabo de un rato y que nadie sabe reproducir.
   */
  let index: string;
  try {
    index = readFileSync(join(webRoot, "index.html"), "utf8");
  } catch {
    throw new Error(
      `WEB_ROOT apunta a "${webRoot}", donde no se puede leer un index.html. ` +
        "Compila el panel (`pnpm --filter @agentinmobi/web build`) o deja la " +
        "variable vacía para servir solo la API.",
    );
  }

  await app.register(fastifyStatic, {
    root: webRoot,
    /*
     * `wildcard: false` para que los ficheros que no existen caigan en el
     * manejador de abajo en vez de resolverse aquí. Es lo que permite que
     * `/leads` —que no es un fichero— acabe recibiendo el `index.html`.
     */
    wildcard: false,
    /*
     * Vite pone un hash en el nombre de cada bundle, así que su contenido nunca
     * cambia y se puede cachear un año. El `index.html` NO: lleva las
     * referencias a esos nombres y, si se cacheara, un despliegue nuevo dejaría
     * navegadores pidiendo bundles que ya no existen.
     */
    maxAge: "1y",
    immutable: true,
    index: false,
  });

  options.logger.info("El panel se sirve desde este proceso", { webRoot });

  app.setNotFoundHandler((request, reply) => {
    if (isBackendPath(request.url) || !wantsHtml(request)) {
      jsonNotFound(request, reply);
      return;
    }

    void reply
      .header("cache-control", "no-cache")
      .type("text/html; charset=utf-8")
      .send(index);
  });
};
