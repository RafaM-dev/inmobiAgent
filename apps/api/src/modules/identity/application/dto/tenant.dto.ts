import { z } from "zod";
import { AgentTone, type BusinessHours } from "../../domain/value-objects/tenant-settings";

/**
 * DTOs de entrada y salida del módulo.
 *
 * La entrada se valida con Zod en la frontera del caso de uso: el dominio nunca
 * recibe datos sin verificar, venga la petición de HTTP, de un job o del CLI.
 */

export const tenantSettingsInputSchema = z.object({
  agentDisplayName: z.string().min(1).max(60).optional(),
  tone: z.nativeEnum(AgentTone).optional(),
  welcomeMessage: z.string().max(500).optional(),
  businessHours: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1),
      from: z.string(),
      to: z.string(),
    })
    .optional(),
  maxConsecutiveFailedTurns: z.number().int().min(1).max(10).optional(),
  handoffEmail: z.string().email().optional(),
});

export const createTenantInputSchema = z.object({
  slug: z.string().min(3).max(60),
  name: z.string().min(2).max(120),
  plan: z.enum(["TRIAL", "STARTER", "PRO", "ENTERPRISE"]).optional(),
  locale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(3).max(60).optional(),
  currency: z.string().length(3).optional(),
  settings: tenantSettingsInputSchema.optional(),
  /** Propietario inicial. Un tenant sin dueño no es operable. */
  owner: z
    .object({
      email: z.string().email(),
      displayName: z.string().min(1).max(120),
    })
    .optional(),
});

export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

/**
 * Proyección de lectura del tenant. Es lo que ven los demás módulos: no
 * exponemos el agregado para que nadie lo mute desde fuera de `identity`.
 */
export interface TenantView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: "ACTIVE" | "SUSPENDED";
  readonly plan: string;
  readonly locale: string;
  readonly timezone: string;
  readonly currency: string;
  readonly settings: {
    readonly agentDisplayName: string;
    readonly tone: AgentTone;
    readonly welcomeMessage?: string;
    /** Horario de atención. Lo usa `appointments` para proponer franjas. */
    readonly businessHours?: BusinessHours;
    readonly maxConsecutiveFailedTurns: number;
    readonly handoffEmail?: string;
  };
}
