import { asFunction, type AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import { registerAuthRoutes } from "./interface/http/auth.routes";
import { registerSettingsRoutes } from "./interface/http/settings.routes";
import { requireRole, requireSession } from "./interface/http/session.guard";
import { UpdateTenantSettingsUseCase } from "./application/use-cases/update-tenant-settings.use-case";
import { UserRole } from "./domain/entities/user";
import { CreateTenantUseCase } from "./application/use-cases/create-tenant.use-case";
import type { AdvisorDirectory } from "./application/ports/advisor-directory";
import type { TenantDirectory } from "./application/ports/tenant-directory";
import type { SessionService } from "./application/ports/session-service";
import { AdvisorDirectoryService } from "./application/services/advisor-directory.service";
import { SessionServiceImpl } from "./application/services/session.service";
import { TenantDirectoryService } from "./application/services/tenant-directory.service";
import { SetUserPasswordUseCase } from "./application/use-cases/set-user-password.use-case";
import type { SessionRepository } from "./domain/repositories/session.repository";
import { PrismaSessionRepository } from "./infrastructure/persistence/prisma/prisma-session.repository";
import type { TenantRepository } from "./domain/repositories/tenant.repository";
import type { UserRepository } from "./domain/repositories/user.repository";
import { PrismaTenantRepository } from "./infrastructure/persistence/prisma/prisma-tenant.repository";
import { PrismaUserRepository } from "./infrastructure/persistence/prisma/prisma-user.repository";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `identity`
 *
 * Esto es lo único que el resto del sistema puede tocar. Todo lo demás es
 * `internal` por convención y por regla de CI (`cross-module-only-via-public-api`).
 * ========================================================================== */

export type { TenantDirectory } from "./application/ports/tenant-directory";
export type { AdvisorDirectory, AdvisorView } from "./application/ports/advisor-directory";
export type {
  SessionService,
  AuthenticatedUser,
  LoginCommand,
  LoginResult,
} from "./application/ports/session-service";
export { SESSION_TTL_MS } from "./application/services/session.service";
/** Guardia reutilizable: lo usa cualquier módulo con rutas de back-office. */
export { requireSession, requireRole, currentUser } from "./interface/http/session.guard";
export type { TenantView, CreateTenantInput } from "./application/dto/tenant.dto";
export type { BusinessHours } from "./domain/value-objects/tenant-settings";
export {
  TenantCreated,
  TenantStatusChanged,
  type TenantCreatedPayload,
  type TenantStatusChangedPayload,
} from "./application/events/identity.events";
export { AgentTone } from "./domain/value-objects/tenant-settings";
export { UserRole } from "./domain/entities/user";

/** Servicios que este módulo aporta al contenedor. */
export interface IdentityCradle {
  tenantRepository: TenantRepository;
  userRepository: UserRepository;
  tenantDirectory: TenantDirectory;
  advisorDirectory: AdvisorDirectory;
  sessionRepository: SessionRepository;
  sessionService: SessionService;
  setUserPassword: SetUserPasswordUseCase;
  createTenant: CreateTenantUseCase;
  updateTenantSettings: UpdateTenantSettingsUseCase;
  /**
   * El mismo directorio, con su caché invalidable.
   *
   * Está aquí porque el contenedor necesita tiparlo, pero se describe con una
   * forma y no con la clase: `invalidate()` es una operación de `identity`
   * sobre su propia caché, y el puerto público sigue siendo de solo lectura.
   */
  tenantCache: TenantDirectory & { invalidate(tenantId: string): void };
}

type Cradle = PlatformCradle & IdentityCradle;

export const identityModule: ModuleRegistration<Cradle, FastifyInstance> = {
  name: "identity",

  registerRoutes(app: FastifyInstance, cradle: Cradle): void {
    const session = requireSession({
      sessions: cradle.sessionService,
      isProduction: cradle.config.isProduction,
    });

    registerAuthRoutes(app, {
      sessions: cradle.sessionService,
      tenants: cradle.tenantDirectory,
      isProduction: cradle.config.isProduction,
      requireSession: session,
    });

    registerSettingsRoutes(app, {
      tenants: cradle.tenantDirectory,
      updateSettings: cradle.updateTenantSettings,
      runtime: {
        llmProvider: cradle.config.providers.llm,
        embeddingProvider: cradle.config.providers.embedding,
      },
      requireSession: session,
      // Cambiar el tono o el horario afecta a todas las conversaciones de la
      // inmobiliaria: no es una preferencia personal de quien está mirando.
      requireAdmin: requireRole(UserRole.OWNER, UserRole.ADMIN),
    });
  },

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      tenantRepository: asFunction(
        (c: Cradle): TenantRepository => new PrismaTenantRepository(c.database),
      ).singleton(),

      userRepository: asFunction(
        (c: Cradle): UserRepository => new PrismaUserRepository(c.database),
      ).singleton(),

      tenantCache: asFunction(
        (c: Cradle) =>
          new TenantDirectoryService({ tenants: c.tenantRepository, clock: c.clock }),
      ).singleton(),

      // El puerto público apunta a la misma instancia, con la vista estrecha.
      tenantDirectory: asFunction((c: Cradle): TenantDirectory => c.tenantCache).singleton(),

      sessionRepository: asFunction(
        (c: Cradle): SessionRepository => new PrismaSessionRepository(c.database),
      ).singleton(),

      sessionService: asFunction(
        (c: Cradle): SessionService =>
          new SessionServiceImpl({
            users: c.userRepository,
            tenants: c.tenantRepository,
            sessions: c.sessionRepository,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
            ids: c.ids,
            logger: c.logger.child({ module: "identity", component: "auth" }),
          }),
      ).singleton(),

      setUserPassword: asFunction(
        (c: Cradle) =>
          new SetUserPasswordUseCase({
            users: c.userRepository,
            sessions: c.sessionRepository,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
          }),
      ).singleton(),

      advisorDirectory: asFunction(
        (c: Cradle): AdvisorDirectory => new AdvisorDirectoryService({ users: c.userRepository }),
      ).singleton(),

      updateTenantSettings: asFunction(
        (c: Cradle) =>
          new UpdateTenantSettingsUseCase({
            tenants: c.tenantRepository,
            unitOfWork: c.unitOfWork,
            clock: c.clock,
            cache: c.tenantCache,
          }),
      ).singleton(),

      createTenant: asFunction(
        (c: Cradle) =>
          new CreateTenantUseCase({
            tenants: c.tenantRepository,
            users: c.userRepository,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
            ids: c.ids,
          }),
      ).singleton(),
    });
  },
};
