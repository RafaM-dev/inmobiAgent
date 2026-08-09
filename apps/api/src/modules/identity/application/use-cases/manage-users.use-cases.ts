import type { Clock } from "../../../../platform/clock/clock";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AppError,
} from "../../../../platform/errors/app-error";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import { err, ok, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import { User, UserRole, UserStatus } from "../../domain/entities/user";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { UserRepository } from "../../domain/repositories/user.repository";
import type { InvitationMailer } from "../services/invitation-mailer";

/**
 * El equipo de una inmobiliaria: invitar, cambiar de rol, dar de baja.
 *
 * Van juntos porque comparten las mismas reglas de quién puede qué, y esas
 * reglas solo se entienden mirándolas a la vez. Separarlas en tres archivos
 * repartiría una única decisión de autorización en tres sitios.
 *
 * **Nadie puede conceder más de lo que tiene.** Un ADMIN no puede crear un
 * OWNER ni tocar a uno: si pudiera, el rol de administrador sería en la
 * práctica el de propietario y la distinción no significaría nada.
 */

export interface TeamMemberView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

const toView = (user: User): TeamMemberView => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});

export class ListTeamUseCase {
  constructor(private readonly deps: { users: UserRepository }) {}

  async execute(): Promise<Result<readonly TeamMemberView[], AppError>> {
    const users = await this.deps.users.listByTenant();
    return ok(users.map(toView));
  }
}

export interface InviteUserCommand {
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** Quién invita. Determina qué roles puede conceder. */
  readonly actor: { userId: string; role: UserRole; displayName: string };
}

export interface InvitationResult {
  readonly user: TeamMemberView;
  /** `false` si el despliegue no tiene correo y hay que pasar el enlace a mano. */
  readonly delivered: boolean;
  /** Solo presente cuando no se pudo entregar. */
  readonly url?: string;
}

export class InviteUserUseCase {
  constructor(
    private readonly deps: {
      users: UserRepository;
      tenants: TenantRepository;
      mailer: InvitationMailer;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(command: InviteUserCommand): Promise<Result<InvitationResult, AppError>> {
    const denied = cannotGrant(command.actor.role, command.role);
    if (denied) return err(denied);

    const tenantId = TenantContext.requireTenantId();
    const email = command.email.trim().toLowerCase();

    const existing = await this.deps.users.findByEmail(email);
    if (existing) {
      /*
       * Reinvitar a alguien que ya está es un caso REAL —se pierde el correo,
       * caduca el enlace— y no un error del usuario. Si sigue invitado, se le
       * manda un enlace nuevo; si ya entró alguna vez, no: eso sería una forma
       * de reiniciarle la cuenta a otro sin ser él.
       */
      if (existing.status !== UserStatus.INVITED) {
        return err(new ConflictError(`${email} ya forma parte del equipo`));
      }
      return this.sendLink(existing, command.actor.displayName);
    }

    const user = User.create({
      id: this.deps.ids.generate(),
      tenantId,
      email,
      displayName: command.displayName,
      role: command.role,
      status: UserStatus.INVITED,
      now: this.deps.clock.now(),
    });

    await this.deps.users.save(user);
    return this.sendLink(user, command.actor.displayName);
  }

  private async sendLink(
    user: User,
    invitedBy: string,
  ): Promise<Result<InvitationResult, AppError>> {
    const tenant = await this.deps.tenants.findById(user.tenantId);
    if (!tenant) return err(new NotFoundError("Inmobiliaria", user.tenantId));

    const link = await this.deps.mailer.issue({
      user,
      purpose: "INVITATION",
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      invitedBy,
    });

    return ok({
      user: toView(user),
      delivered: link.delivered,
      // El enlace solo viaja de vuelta cuando NO se pudo entregar. Quien
      // invita ya tiene potestad para dar ese acceso, así que enseñárselo no
      // concede nada nuevo; enseñarlo siempre sí lo dejaría en más sitios.
      ...(link.delivered ? {} : { url: link.url }),
    });
  }
}

export interface UpdateTeamMemberCommand {
  readonly userId: string;
  /**
   * `| undefined` explícito y no `?`: con `exactOptionalPropertyTypes` no es lo
   * mismo. La ruta construye el comando esparciendo lo que llegó, así que la
   * clave existe aunque valga `undefined`.
   */
  readonly role: UserRole | undefined;
  readonly status: Extract<UserStatus, "ACTIVE" | "DISABLED"> | undefined;
  readonly actor: { userId: string; role: UserRole };
}

export class UpdateTeamMemberUseCase {
  constructor(private readonly deps: { users: UserRepository; clock: Clock }) {}

  async execute(command: UpdateTeamMemberCommand): Promise<Result<TeamMemberView, AppError>> {
    const user = await this.deps.users.findById(command.userId);
    if (!user) return err(new NotFoundError("Usuario", command.userId));

    // Tocar a alguien de rango igual o superior queda fuera del alcance de
    // quien actúa: si no, un ADMIN podría degradar al propietario.
    const overReach = cannotGrant(command.actor.role, user.role);
    if (overReach) return err(overReach);

    if (command.role !== undefined) {
      const denied = cannotGrant(command.actor.role, command.role);
      if (denied) return err(denied);
    }

    /*
     * Nadie se desactiva ni se degrada a sí mismo. No es paternalismo: es lo
     * que evita que la única persona con acceso se cierre la puerta y haga
     * falta entrar por consola para abrirla.
     */
    if (command.userId === command.actor.userId) {
      return err(
        new ForbiddenError("No puedes cambiar tu propio rol ni desactivar tu propia cuenta"),
      );
    }

    const now = this.deps.clock.now();
    if (command.role !== undefined) user.changeRole(command.role, now);
    if (command.status === UserStatus.ACTIVE) user.activate(now);
    // `disable()` protege al propietario por su cuenta, en el dominio.
    if (command.status === UserStatus.DISABLED) user.disable(now);

    await this.deps.users.save(user);
    return ok(toView(user));
  }
}

/** `null` cuando sí puede. Un error explicado cuando no. */
const cannotGrant = (actor: UserRole, target: UserRole): AppError | null => {
  if (actor === UserRole.OWNER) return null;
  if (actor !== UserRole.ADMIN) {
    return new ForbiddenError("Tu rol no permite gestionar el equipo");
  }
  if (target === UserRole.OWNER || target === UserRole.ADMIN) {
    return new ForbiddenError(
      "Solo el propietario puede crear o modificar administradores y propietarios",
    );
  }
  return null;
};
