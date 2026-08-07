import { z } from "zod";
import { idSchema, isoDateTimeSchema, slugSchema } from "../common/primitives";

/**
 * Contratos de acceso al back-office.
 *
 * El token de sesión NO aparece por ninguna parte: viaja en una cookie
 * `httpOnly` que el navegador maneja solo y que ningún JavaScript puede leer.
 * Lo que se devuelve es quién eres, no con qué lo demuestras.
 */

export const userRoleSchema = z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const loginRequestSchema = z.object({
  /** Identificador de la inmobiliaria: el mismo correo puede estar en varias. */
  tenantSlug: slugSchema,
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  userId: idSchema,
  tenantId: idSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: userRoleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  tenantSlug: slugSchema,
  tenantName: z.string(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
