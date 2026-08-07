import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { ConflictError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { err, ok, type Result } from "../../../../platform/result/result";
import { Tenant, TenantPlan } from "../../domain/entities/tenant";
import { User, UserRole, UserStatus } from "../../domain/entities/user";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { UserRepository } from "../../domain/repositories/user.repository";
import { TenantSettings } from "../../domain/value-objects/tenant-settings";
import { createTenantInputSchema, type CreateTenantInput, type TenantView } from "../dto/tenant.dto";
import { TenantCreated } from "../events/identity.events";
import { toTenantView } from "../mappers/tenant.mapper";

/**
 * Alta de una inmobiliaria en la plataforma.
 *
 * Todo ocurre en una sola transacción, evento de integración incluido: si algo
 * falla, no queda ni un tenant a medias ni un `TenantCreated` publicado sobre
 * un tenant que no existe. Esa garantía es la razón de ser del outbox.
 */
export class CreateTenantUseCase {
  constructor(
    private readonly deps: {
      tenants: TenantRepository;
      users: UserRepository;
      unitOfWork: UnitOfWork;
      events: EventPublisher;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(input: CreateTenantInput): Promise<Result<TenantView, AppError>> {
    const parsed = createTenantInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new ValidationError(
          "Datos de tenant inválidos",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
    }
    const data = parsed.data;

    const existing = await this.deps.tenants.findBySlug(data.slug.toLowerCase());
    if (existing) {
      return err(new ConflictError(`Ya existe un tenant con el identificador "${data.slug}"`));
    }

    const now = this.deps.clock.now();
    const tenant = Tenant.create({
      id: this.deps.ids.generate(),
      slug: data.slug,
      name: data.name,
      ...(data.plan ? { plan: TenantPlan[data.plan] } : {}),
      ...(data.locale ? { locale: data.locale } : {}),
      ...(data.timezone ? { timezone: data.timezone } : {}),
      ...(data.currency ? { currency: data.currency } : {}),
      settings: TenantSettings.create(data.settings ?? {}),
      now,
    });

    const owner = data.owner
      ? User.create({
          id: this.deps.ids.generate(),
          tenantId: tenant.id,
          email: data.owner.email,
          displayName: data.owner.displayName,
          role: UserRole.OWNER,
          status: UserStatus.ACTIVE,
          now,
        })
      : undefined;

    await this.deps.unitOfWork.run(async () => {
      await this.deps.tenants.save(tenant);
      if (owner) await this.deps.users.save(owner);
      await this.deps.events.publish(
        TenantCreated,
        {
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          plan: tenant.plan,
          locale: tenant.locale,
          timezone: tenant.timezone,
          currency: tenant.currency,
        },
        { tenantId: tenant.id },
      );
    });

    return ok(toTenantView(tenant));
  }
}
