import { z } from "zod";

/**
 * Forma única de error de la API. El frontend nunca parsea mensajes de texto:
 * ramifica sobre `code`, que es estable y versionado.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Errores de validación campo a campo. */
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    /** Para correlacionar con los logs del servidor al reportar una incidencia. */
    correlationId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
