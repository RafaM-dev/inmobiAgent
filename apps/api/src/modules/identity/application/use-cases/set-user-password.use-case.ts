import type { Clock } from "../../../../platform/clock/clock";
import { hashPassword } from "../../../../platform/crypto/password";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { NotFoundError, ValidationError, type AppError } from "../../../../platform/errors/app-error";
import { err, okVoid, type Result } from "../../../../platform/result/result";
import type { SessionRepository } from "../../domain/repositories/session.repository";
import type { UserRepository } from "../../domain/repositories/user.repository";

/** Mínimo razonable. Longitud antes que reglas de símbolos, como recomienda NIST. */
const MIN_LENGTH = 10;

export interface SetUserPasswordCommand {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

/**
 * Fija la contraseña de un usuario.
 *
 * Cierra TODAS sus sesiones abiertas. Es lo que se espera de un cambio de
 * contraseña: si se cambia porque alguien pudo haberla visto, dejar viva la
 * sesión de ese alguien vacía la operación de sentido.
 *
 * Se exige longitud y nada más. Las reglas de "una mayúscula y un símbolo"
 * producen contraseñas peores y predecibles; la longitud es lo que aporta
 * entropía de verdad.
 */
export class SetUserPasswordUseCase {
  constructor(
    private readonly deps: {
      users: UserRepository;
      sessions: SessionRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(command: SetUserPasswordCommand): Promise<Result<void, AppError>> {
    if (command.password.length < MIN_LENGTH) {
      return err(
        new ValidationError(
          `La contraseña debe tener al menos ${String(MIN_LENGTH)} caracteres.`,
        ),
      );
    }

    const user = await this.deps.users.findByEmailInTenant(
      command.tenantId,
      command.email.trim().toLowerCase(),
    );
    if (!user) return err(new NotFoundError("Usuario", command.email));

    const now = this.deps.clock.now();
    user.setPasswordHash(await hashPassword(command.password), now);

    await this.deps.unitOfWork.run(async () => {
      await this.deps.users.save(user);
      await this.deps.sessions.revokeAllForUser(user.id, now);
    });

    return okVoid();
  }
}
