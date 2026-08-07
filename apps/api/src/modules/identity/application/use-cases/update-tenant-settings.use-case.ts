import type { Clock } from "../../../../platform/clock/clock";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, type AppError } from "../../../../platform/errors/app-error";
import { err, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { TenantSettingsInput } from "../../domain/value-objects/tenant-settings";
import type { TenantView } from "../dto/tenant.dto";
import { toTenantView } from "../mappers/tenant.mapper";

/**
 * Cambia cómo se comporta el agente de una inmobiliaria.
 *
 * Dos decisiones:
 *
 * 1. **El tenant sale del contexto, no del comando.** No hay forma de que una
 *    petición pida cambiar la configuración de otra inmobiliaria, porque no hay
 *    dónde escribirlo. La cookie es el único origen del tenant.
 *
 * 2. **La actualización es PARCIAL.** Solo se toca lo que llega. Reemplazar el
 *    objeto entero haría que dos asesores editando a la vez se pisaran campos
 *    que ninguno de los dos tocó — y la validación de cada campo sigue viviendo
 *    en el Value Object, que es quien sabe qué es un horario válido.
 */
export class UpdateTenantSettingsUseCase {
  constructor(
    private readonly deps: {
      tenants: TenantRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(changes: TenantSettingsInput): Promise<Result<TenantView, AppError>> {
    const tenantId = TenantContext.requireTenantId();

    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) return err(new NotFoundError("Inmobiliaria", tenantId));

    // `with` valida y devuelve un VO nuevo: si el horario es inválido, esto
    // lanza un DomainError antes de que nada llegue a la base.
    tenant.updateSettings(tenant.settings.with(changes), this.deps.clock.now());

    await this.deps.unitOfWork.run(async () => {
      await this.deps.tenants.save(tenant);
    });

    return ok(toTenantView(tenant));
  }
}
