import type { Clock } from "../../../../platform/clock/clock";
import { hashSessionToken } from "../../../../platform/crypto/password";
import { ValidationError, type AppError } from "../../../../platform/errors/app-error";
import type { Logger } from "../../../../platform/logging/logger";
import { err, isErr, ok, okVoid, type Result } from "../../../../platform/result/result";
import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { UserRepository } from "../../domain/repositories/user.repository";
import type { UserTokenRepository } from "../../domain/repositories/user-token.repository";
import type { InvitationMailer } from "../services/invitation-mailer";
import type { SetUserPasswordUseCase } from "./set-user-password.use-case";

/**
 * Entrar sin poder entrar: aceptar una invitación y recuperar la contraseña.
 *
 * Los dos caminos son PÚBLICOS —quien los usa no tiene sesión, por definición—
 * y por eso son la superficie más delicada del back-office. Tres reglas los
 * gobiernan:
 *
 * 1. El token resuelve el tenant, igual que hace la cookie. No se acepta ningún
 *    identificador de inmobiliaria que venga del cliente.
 * 2. Se responde lo mismo exista o no la cuenta. Un mensaje distinto convierte
 *    el formulario en un comprobador de quién trabaja en cada inmobiliaria.
 * 3. Al fijar la contraseña se cierran TODAS las sesiones de esa persona. Si se
 *    restablece porque alguien pudo haber entrado, dejar viva su sesión vacía
 *    la operación de sentido.
 */

export interface RequestPasswordResetCommand {
  readonly tenantSlug: string;
  readonly email: string;
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly deps: {
      users: UserRepository;
      tenants: TenantRepository;
      mailer: InvitationMailer;
      logger: Logger;
    },
  ) {}

  /**
   * Siempre `ok`, haya cuenta o no.
   *
   * Es deliberado y va contra el instinto de "devolver un 404 si no existe":
   * responder distinto permitiría a cualquiera averiguar qué correos tienen
   * cuenta en qué inmobiliaria, probando uno a uno.
   */
  async execute(command: RequestPasswordResetCommand): Promise<Result<void, AppError>> {
    const slug = command.tenantSlug.trim().toLowerCase();
    const email = command.email.trim().toLowerCase();

    const tenant = await this.deps.tenants.findBySlug(slug);
    const user = tenant ? await this.deps.users.findByEmailInTenant(tenant.id, email) : null;

    if (!tenant || !user) {
      this.deps.logger.info("Recuperación pedida para una cuenta que no existe", { slug });
      return okVoid();
    }

    // A quien está solo invitado se le reenvía la invitación, no un
    // restablecimiento: todavía no tiene contraseña que restablecer.
    await this.deps.mailer.issue({
      user,
      purpose: user.status === "INVITED" ? "INVITATION" : "PASSWORD_RESET",
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    });

    return okVoid();
  }
}

export interface RedeemTokenCommand {
  readonly token: string;
  readonly password: string;
}

export interface RedeemedAccount {
  readonly tenantSlug: string;
  readonly email: string;
}

/**
 * Consume un enlace y fija la contraseña.
 *
 * **Un solo caso de uso para invitación y recuperación**, porque son la misma
 * operación: comprobar un token de un solo uso y dejar una contraseña nueva.
 * Lo único que cambia es de dónde venía el enlace. Duplicarlo daría dos
 * implementaciones del mismo control de seguridad, y tarde o temprano
 * divergirían.
 */
export class RedeemUserTokenUseCase {
  constructor(
    private readonly deps: {
      tokens: UserTokenRepository;
      users: UserRepository;
      tenants: TenantRepository;
      setPassword: SetUserPasswordUseCase;
      clock: Clock;
    },
  ) {}

  async execute(command: RedeemTokenCommand): Promise<Result<RedeemedAccount, AppError>> {
    const now = this.deps.clock.now();

    // Se busca por HASH: el token en claro nunca ha estado en la base.
    const token = await this.deps.tokens.findByTokenHash(hashSessionToken(command.token));

    if (!token?.isUsable(now)) {
      /*
       * Un solo mensaje para "no existe", "caducado" y "ya usado". Distinguirlos
       * ayudaría a quien se equivoca de enlace, y también a quien prueba tokens
       * al azar; el segundo importa más.
       */
      return err(
        new ValidationError(
          "Este enlace ya no es válido. Puede haber caducado o haberse usado ya. " +
            "Pide uno nuevo desde la pantalla de acceso.",
        ),
      );
    }

    const user = await this.deps.users.findByIdUnscoped(token.userId);
    const tenant = user ? await this.deps.tenants.findById(user.tenantId) : null;
    if (!user || !tenant) {
      return err(new ValidationError("Este enlace ya no es válido."));
    }

    /*
     * A partir de aquí sí hay tenant, y todo lo que sigue corre dentro de su
     * contexto: guardar el usuario exige `assertWritableTenant`. Es el mismo
     * patrón que el guardia de sesión, con el token en el papel de la cookie.
     */
    return TenantContext.run(
      { tenantId: tenant.id, correlationId: token.id, userId: user.id, source: "http" },
      async () => {
        const applied = await this.deps.setPassword.execute({
          tenantId: tenant.id,
          email: user.email,
          password: command.password,
        });
        // Una contraseña demasiado corta NO consume el enlace: quien se
        // equivoca al escribirla debe poder reintentar con el mismo correo.
        if (isErr(applied)) return applied;

        token.consume(now);
        await this.deps.tokens.save(token);

        return ok({ tenantSlug: tenant.slug, email: user.email });
      },
    );
  }
}
