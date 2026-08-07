import type { Clock } from "../../../../platform/clock/clock";
import {
  generateSessionToken,
  hashSessionToken,
  verifyPassword,
} from "../../../../platform/crypto/password";
import type { UnitOfWork } from "../../../../platform/database/unit-of-work";
import { UnauthorizedError, type AppError } from "../../../../platform/errors/app-error";
import type { IdGenerator } from "../../../../platform/ids/id-generator";
import type { Logger } from "../../../../platform/logging/logger";
import { err, ok, okVoid, type Result } from "../../../../platform/result/result";
import { Session } from "../../domain/entities/session";
import type { SessionRepository } from "../../domain/repositories/session.repository";
import type { TenantRepository } from "../../domain/repositories/tenant.repository";
import type { UserRepository } from "../../domain/repositories/user.repository";
import type {
  AuthenticatedUser,
  LoginCommand,
  LoginResult,
  SessionService,
} from "../ports/session-service";

/** Duración de una sesión inactiva. Se prorroga sola mientras haya actividad. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Acceso al back-office.
 *
 * Dos reglas de seguridad que se cumplen aquí y no se pueden olvidar más arriba:
 *
 * 1. **Un fallo de acceso siempre dice lo mismo.** Da igual si la inmobiliaria
 *    no existe, si el correo no está, si el usuario está desactivado o si la
 *    contraseña es incorrecta: el mensaje y el tiempo son los mismos. Distinguir
 *    "usuario no encontrado" de "contraseña incorrecta" convierte el formulario
 *    en un directorio de quién trabaja en cada inmobiliaria.
 *
 * 2. **Se verifica la contraseña incluso cuando el usuario no existe.** Sin eso,
 *    un correo inexistente responde en un milisegundo y uno real en cincuenta,
 *    y esa diferencia es un oráculo.
 */
export class SessionServiceImpl implements SessionService {
  constructor(
    private readonly deps: {
      users: UserRepository;
      tenants: TenantRepository;
      sessions: SessionRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      ttlMs?: number;
    },
  ) {}

  private get ttl(): number {
    return this.deps.ttlMs ?? SESSION_TTL_MS;
  }

  async login(command: LoginCommand): Promise<Result<LoginResult, AppError>> {
    const tenant = await this.deps.tenants.findBySlug(command.tenantSlug.trim().toLowerCase());
    const email = command.email.trim().toLowerCase();

    const user = tenant ? await this.deps.users.findByEmailInTenant(tenant.id, email) : null;


    /*
     * Verificación en todos los casos. `verifyPassword` sobre un hash falso
     * cuesta lo mismo que sobre uno real, así que el tiempo de respuesta no
     * revela si el correo existe.
     */
    const stored = user?.passwordHash ?? FAKE_HASH;
    const passwordOk = await verifyPassword(command.password, stored);

    if (!tenant || !user || !passwordOk || !user.canSignIn || tenant.status !== "ACTIVE") {
      this.deps.logger.warn("Intento de acceso fallido", {
        tenantSlug: command.tenantSlug,
        // El correo NO se registra completo: un log no debe ser un padrón.
        email: maskEmail(email),
      });
      return err(new UnauthorizedError("Credenciales incorrectas"));
    }

    const now = this.deps.clock.now();
    const token = generateSessionToken();

    const session = Session.issue({
      id: this.deps.ids.generate(),
      tenantId: tenant.id,
      userId: user.id,
      tokenHash: hashSessionToken(token),
      ...(command.userAgent !== undefined ? { userAgent: command.userAgent } : {}),
      ...(command.ipAddress !== undefined ? { ipAddress: command.ipAddress } : {}),
      ttlMs: this.ttl,
      now,
    });

    await this.deps.unitOfWork.run(async () => {
      await this.deps.sessions.save(session);
    });

    return ok({
      token,
      expiresAt: session.expiresAt,
      user: toAuthenticated(user),
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });
  }

  async authenticate(token: string): Promise<Result<AuthenticatedUser, AppError>> {
    if (token.length === 0) return err(new UnauthorizedError("Sesión no iniciada"));

    const session = await this.deps.sessions.findByTokenHash(hashSessionToken(token));
    const now = this.deps.clock.now();

    if (!session?.isValidAt(now)) return err(new UnauthorizedError("Sesión caducada"));

    const user = await this.deps.users.findByIdUnscoped(session.userId);
    // El estado del usuario manda sobre la sesión: desactivar a alguien tiene
    // que echarlo en la siguiente petición, no cuando le caduque la cookie.
    if (!user?.canSignIn) return err(new UnauthorizedError("Sesión no válida"));

    // La prórroga solo se persiste cuando de verdad avanza, para no escribir en
    // la base en cada petición del inbox.
    if (session.touch(now, this.ttl)) {
      await this.deps.sessions.save(session);
    }

    return ok(toAuthenticated(user));
  }

  async logout(token: string): Promise<Result<void, AppError>> {
    if (token.length === 0) return okVoid();

    const session = await this.deps.sessions.findByTokenHash(hashSessionToken(token));
    if (!session) return okVoid();

    session.revoke(this.deps.clock.now());
    await this.deps.sessions.save(session);

    return okVoid();
  }
}

const toAuthenticated = (user: {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: AuthenticatedUser["role"];
}): AuthenticatedUser => ({
  userId: user.id,
  tenantId: user.tenantId,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
});

/**
 * Hash con la forma correcta y una contraseña que nadie conoce. Existe solo
 * para que verificar contra un usuario inexistente cueste lo mismo que contra
 * uno real.
 */
const FAKE_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAA";

const maskEmail = (email: string): string => {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
};
