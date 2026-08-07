import type { Prisma } from "../../generated/prisma/client";

/**
 * Normaliza un valor del dominio a JSON persistible.
 *
 * Hace dos cosas que hay que hacer siempre y en un solo sitio: descarta las
 * propiedades `undefined` (que Prisma rechaza dentro de un campo Json) y
 * convierte las fechas a ISO-8601. Sin esto, cada repositorio acabaría con su
 * propia versión ligeramente distinta del mismo `JSON.parse(JSON.stringify(…))`.
 */
export const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
