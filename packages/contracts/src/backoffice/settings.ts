import { z } from "zod";
import { idSchema, slugSchema } from "../common/primitives";

/**
 * Configuración del agente.
 *
 * Lo que se configura aquí es **negocio, no modelo**: cómo se llama el
 * asistente, con qué tono habla, en qué horario propone visitas y cuándo deja
 * de intentarlo y llama a una persona. Nada de esto menciona un proveedor de IA,
 * y por eso sobrevive a cambiar de proveedor.
 *
 * Lo que sí depende del proveedor viaja aparte, en `runtime`, y es de SOLO
 * LECTURA: se elige por variable de entorno al desplegar, no desde una pantalla.
 * Cambiar el modelo de embeddings desde el navegador invalidaría en silencio
 * todo lo indexado (D25).
 */

export const agentToneSchema = z.enum(["FORMAL", "CERCANO", "NEUTRO"]);
export type AgentToneContract = z.infer<typeof agentToneSchema>;

export const businessHoursSchema = z.object({
  /** Días activos, 0 = domingo. */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm"),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm"),
});
export type BusinessHoursContract = z.infer<typeof businessHoursSchema>;

export const agentSettingsSchema = z.object({
  agentDisplayName: z.string(),
  tone: agentToneSchema,
  welcomeMessage: z.string().optional(),
  businessHours: businessHoursSchema.optional(),
  /** Turnos seguidos con fallo antes de pasar la conversación a una persona. */
  maxConsecutiveFailedTurns: z.number().int(),
  handoffEmail: z.string().optional(),
  /**
   * Tope de gasto en IA por mes, en USD. Ausente = el tope del despliegue.
   * Cero significa SIN tope, no `no gastes nada`: a quien olvidó configurarlo
   * no se le puede apagar el agente.
   */
  monthlyBudgetUsd: z.number().optional(),
});
export type AgentSettingsContract = z.infer<typeof agentSettingsSchema>;

/** Cómo está desplegado el sistema. Solo lectura: lo fija el entorno. */
export const runtimeInfoSchema = z.object({
  llmProvider: z.string(),
  embeddingProvider: z.string(),
  /** `true` cuando ningún proveedor de pago está activo. */
  demoMode: z.boolean(),
});
export type RuntimeInfoContract = z.infer<typeof runtimeInfoSchema>;

export const channelAccountSchema = z.object({
  id: idSchema,
  channelType: z.enum(["CONSOLE", "WEBCHAT", "WHATSAPP", "TELEGRAM", "MESSENGER", "INSTAGRAM"]),
  /** Identificador de la cuenta EN EL PROVEEDOR. */
  externalId: z.string(),
  displayName: z.string(),
  isActive: z.boolean(),
});
export type ChannelAccountContract = z.infer<typeof channelAccountSchema>;

/**
 * Los canales viajan en SU PROPIA respuesta, no dentro de la configuración.
 *
 * No es una decisión estética: los canales son del módulo `channels`, que ya
 * depende de `identity`. Meterlos en `/api/settings` obligaría a `identity` a
 * conocer `channels` y cerraría un ciclo entre módulos — el primer paso para
 * que un monolito modular deje de ser modular.
 */
export const channelAccountListResponseSchema = z.object({
  items: z.array(channelAccountSchema),
  /**
   * Canales que ESTE despliegue sabe operar, estén o no dados de alta.
   *
   * Viaja con la lista porque es la única forma honesta de que la pantalla
   * sepa si ofrecer «conectar WhatsApp». Deducirlo de si ya hay una cuenta
   * daría exactamente el caso contrario al que importa: sin cuenta y sin app
   * de Meta configurada, se pintaría un formulario que no puede funcionar.
   */
  available: z.array(channelAccountSchema.shape.channelType),
});
export type ChannelAccountListResponse = z.infer<typeof channelAccountListResponseSchema>;

/**
 * Alta de un número de WhatsApp.
 *
 * Solo dos datos, y ninguno es de la app de Meta: esa es de la plataforma y se
 * configura al desplegar. Lo que aporta cada inmobiliaria es SU número —el
 * `phone_number_id` que Meta le asigna— y el token con el que se envía en su
 * nombre.
 *
 * `phoneNumberId` no lleva formato validado a propósito. Es un identificador
 * opaco de un proveedor externo: exigirle que sean dígitos funcionaría hasta el
 * día que Meta cambie de criterio, y entonces el producto rechazaría números
 * perfectamente válidos por una suposición nuestra.
 */
export const connectWhatsAppRequestSchema = z.object({
  phoneNumberId: z.string().trim().min(1).max(120),
  /** Cómo se llama esta línea en el panel. Para humanos, no para Meta. */
  displayName: z.string().trim().min(1).max(60),
  accessToken: z.string().trim().min(1).max(2000),
});
export type ConnectWhatsAppRequest = z.infer<typeof connectWhatsAppRequestSchema>;

export const connectChannelResponseSchema = z.object({
  account: channelAccountSchema,
  /**
   * Si se pudo confirmar contra el proveedor que las credenciales sirven.
   *
   * `false` NO significa que estén mal: significa que no se pudo comprobar.
   * La cuenta queda guardada igual —ver D80— y la pantalla lo advierte.
   */
  verified: z.boolean(),
  /** Qué impidió confirmarlo. Ausente cuando `verified` es `true`. */
  verificationMessage: z.string().optional(),
});
export type ConnectChannelResponse = z.infer<typeof connectChannelResponseSchema>;

export const settingsResponseSchema = z.object({
  tenant: z.object({
    id: idSchema,
    slug: slugSchema,
    name: z.string(),
    locale: z.string(),
    timezone: z.string(),
    currency: z.string(),
    plan: z.string(),
  }),
  agent: agentSettingsSchema,
  runtime: runtimeInfoSchema,
  /** `false` para roles que solo miran: la pantalla se pinta en modo lectura. */
  canEdit: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/**
 * Actualización parcial: solo se toca lo que viene. Enviar el objeto entero
 * desde el navegador haría que dos asesores editando a la vez se pisaran
 * campos que ninguno de los dos tocó.
 */
export const updateAgentSettingsRequestSchema = z
  .object({
    agentDisplayName: z.string().min(1).max(60),
    tone: agentToneSchema,
    welcomeMessage: z.string().max(500),
    businessHours: businessHoursSchema,
    maxConsecutiveFailedTurns: z.number().int().min(1).max(10),
    handoffEmail: z.string().email().max(200),
    monthlyBudgetUsd: z.number().min(0).max(1_000_000),
  })
  .partial();
export type UpdateAgentSettingsRequest = z.infer<typeof updateAgentSettingsRequestSchema>;

/**
 * Consumo del periodo en curso.
 *
 * Va en su propia respuesta, y no dentro de `/api/settings`, por la misma
 * razón que los canales (D38): el contador es del módulo `agent`, que ya
 * depende de `identity`. Meterlo ahí cerraría un ciclo entre módulos.
 */
export const usageSummarySchema = z.object({
  /** `YYYY-MM` en la zona horaria de la inmobiliaria. */
  period: z.string(),
  spentUsd: z.number(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  turns: z.number().int(),
  /** Tope vigente. `0` = sin tope. */
  limitUsd: z.number(),
  /** Fracción del tope consumida. `0` cuando no hay tope. */
  ratio: z.number(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;
