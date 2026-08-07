import {
  updateAgentSettingsRequestSchema,
  type SettingsResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NotFoundError, ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import type { TenantView } from "../../application/dto/tenant.dto";
import type { TenantDirectory } from "../../application/ports/tenant-directory";
import type { UpdateTenantSettingsUseCase } from "../../application/use-cases/update-tenant-settings.use-case";
import { UserRole } from "../../domain/entities/user";
import { currentUser } from "./session.guard";

type Guard = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) => void;

export interface SettingsRoutesDeps {
  tenants: TenantDirectory;
  updateSettings: UpdateTenantSettingsUseCase;
  runtime: {
    llmProvider: string;
    embeddingProvider: string;
  };
  requireSession: Guard;
  requireAdmin: Guard;
}

/** Quién puede cambiar cómo habla el agente con TODOS los clientes. */
const EDITORS: readonly UserRole[] = [UserRole.OWNER, UserRole.ADMIN];

const toResponse = (
  tenant: TenantView,
  runtime: SettingsRoutesDeps["runtime"],
  canEdit: boolean,
): SettingsResponse => ({
  tenant: {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    locale: tenant.locale,
    timezone: tenant.timezone,
    currency: tenant.currency,
    plan: tenant.plan,
  },
  agent: {
    agentDisplayName: tenant.settings.agentDisplayName,
    tone: tenant.settings.tone,
    ...(tenant.settings.welcomeMessage !== undefined
      ? { welcomeMessage: tenant.settings.welcomeMessage }
      : {}),
    ...(tenant.settings.businessHours !== undefined
      ? {
          businessHours: {
            days: [...tenant.settings.businessHours.days],
            from: tenant.settings.businessHours.from,
            to: tenant.settings.businessHours.to,
          },
        }
      : {}),
    maxConsecutiveFailedTurns: tenant.settings.maxConsecutiveFailedTurns,
    ...(tenant.settings.handoffEmail !== undefined
      ? { handoffEmail: tenant.settings.handoffEmail }
      : {}),
  },
  runtime: {
    llmProvider: runtime.llmProvider,
    embeddingProvider: runtime.embeddingProvider,
    // "Demo" no es un interruptor: es la consecuencia de que ningún proveedor
    // de pago esté activo. Si se derivara de una variable propia, podría mentir.
    demoMode: runtime.llmProvider === "mock" && runtime.embeddingProvider === "mock",
  },
  canEdit,
});

/**
 * Configuración del agente.
 *
 * Lo que se configura aquí es negocio —nombre, tono, horario, cuándo llamar a
 * una persona— y por eso sobrevive a cambiar de proveedor de IA. Lo que sí
 * depende del proveedor se DEVUELVE pero no se acepta: el modelo se elige al
 * desplegar, porque cambiar el de embeddings desde una pantalla invalidaría en
 * silencio todo lo indexado (D25).
 */
export const registerSettingsRoutes = (app: FastifyInstance, deps: SettingsRoutesDeps): void => {
  app.get("/api/settings", { preHandler: deps.requireSession }, async (request, reply) => {
    const user = currentUser(request);
    const tenant = await deps.tenants.findById(user.tenantId);
    if (!tenant) throw new NotFoundError("Inmobiliaria", user.tenantId);

    return reply.send(toResponse(tenant, deps.runtime, EDITORS.includes(user.role)));
  });

  app.patch(
    "/api/settings",
    { preHandler: [deps.requireSession, deps.requireAdmin] },
    async (request, reply) => {
      const parsed = updateAgentSettingsRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Configuración inválida",
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      const result = await deps.updateSettings.execute(parsed.data);
      if (isErr(result)) throw result.error;

      return reply.send(toResponse(result.value, deps.runtime, true));
    },
  );
};
