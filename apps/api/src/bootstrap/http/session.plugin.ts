import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

/**
 * Soporte de cookies para el servidor.
 *
 * Aquí NO hay nada de identidad: el guardia que valida la sesión vive en
 * `identity`, que es quien sabe qué es una sesión. Si este archivo importara el
 * módulo, `identity` y `bootstrap` se referenciarían mutuamente — el mismo
 * ciclo que la decisión D8 resolvió para el contenedor de dependencias.
 */
export const registerSessionSupport = async (app: FastifyInstance): Promise<void> => {
  await app.register(cookie);
  app.decorateRequest("user", undefined);
};
