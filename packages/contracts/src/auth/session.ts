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

/* ========================================================================== *
 * Entrar sin poder entrar
 *
 * Dos caminos públicos: aceptar una invitación y recuperar la contraseña. Los
 * dos acaban en lo mismo —elegir contraseña con un enlace de un solo uso— y por
 * eso comparten contrato de canje.
 * ========================================================================== */

export const requestPasswordResetSchema = z.object({
  tenantSlug: slugSchema,
  email: z.string().email().max(200),
});
export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetSchema>;

/**
 * Canje del enlace, valga para invitación o para restablecimiento.
 *
 * NO lleva correo ni inmobiliaria: los resuelve el token, igual que hace la
 * cookie con la sesión. Aceptar aquí un identificador enviado por el cliente
 * sería dejar que quien llama diga a qué cuenta se refiere.
 */
export const redeemTokenSchema = z.object({
  token: z.string().min(20).max(500),
  /** Longitud antes que reglas de símbolos, como recomienda el NIST. */
  password: z.string().min(10).max(200),
});
export type RedeemTokenRequest = z.infer<typeof redeemTokenSchema>;

export const redeemTokenResponseSchema = z.object({
  /** Para poder llevar a la pantalla de acceso con los campos ya puestos. */
  tenantSlug: slugSchema,
  email: z.string().email(),
});
export type RedeemTokenResponse = z.infer<typeof redeemTokenResponseSchema>;

/* ------------------------------------------------------------------ equipo */

export const userStatusSchema = z.enum(["ACTIVE", "INVITED", "DISABLED"]);
export type UserStatusContract = z.infer<typeof userStatusSchema>;

export const teamMemberSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamListResponseSchema = z.object({
  items: z.array(teamMemberSchema),
  /** `false` para roles que solo miran: la pantalla se pinta en modo lectura. */
  canManage: z.boolean(),
});
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;

export const inviteUserRequestSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(1).max(120),
  role: userRoleSchema,
});
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

export const inviteUserResponseSchema = z.object({
  user: teamMemberSchema,
  /** `false` cuando el despliegue no tiene correo configurado. */
  delivered: z.boolean(),
  /**
   * El enlace, SOLO cuando no se pudo entregar por correo, para que quien
   * invita pueda pasarlo a mano. Quien invita ya tiene potestad para conceder
   * ese acceso, así que verlo no le da nada que no tuviera.
   */
  url: z.string().optional(),
});
export type InviteUserResponse = z.infer<typeof inviteUserResponseSchema>;

export const updateTeamMemberRequestSchema = z
  .object({
    role: userRoleSchema,
    status: z.enum(["ACTIVE", "DISABLED"]),
  })
  .partial();
export type UpdateTeamMemberRequest = z.infer<typeof updateTeamMemberRequestSchema>;
