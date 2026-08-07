import { z } from "zod";

/** Identificador universal del sistema. Usamos UUID v7 (ordenable por tiempo). */
export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

/** Slug legible y estable (tenants, colecciones, plantillas). */
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Debe ser kebab-case en minúsculas");
export type Slug = z.infer<typeof slugSchema>;

/** Fecha en ISO-8601 UTC. El transporte nunca usa objetos Date. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/**
 * Dinero como entero en la unidad mínima (centavos) para evitar errores de
 * coma flotante. 1.500.000 COP => { amount: 150000000, currency: "COP" }.
 */
export const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3).toUpperCase(),
});
export type Money = z.infer<typeof moneySchema>;

export const moneyRangeSchema = z
  .object({ min: moneySchema.optional(), max: moneySchema.optional() })
  .refine((r) => !r.min || !r.max || r.min.currency === r.max.currency, {
    message: "min y max deben usar la misma moneda",
  })
  .refine((r) => !r.min || !r.max || r.min.amount <= r.max.amount, {
    message: "min no puede ser mayor que max",
  });
export type MoneyRange = z.infer<typeof moneyRangeSchema>;
