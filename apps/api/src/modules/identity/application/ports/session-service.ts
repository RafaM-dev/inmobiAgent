import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { UserRole } from "../../domain/entities/user";

/**
 * PUERTO `SessionService` — quién está usando el back-office.
 *
 * Es lo único que la capa HTTP necesita saber de identidad. La propiedad que
 * sostiene todo lo demás: **el `tenantId` sale de la sesión, jamás de la
 * petición**. Ni de un parámetro, ni de una cabecera, ni del cuerpo. Un asesor
 * autenticado no puede pedir los leads de otra inmobiliaria porque no existe
 * ningún sitio donde escribir de cuál los quiere.
 */

export interface AuthenticatedUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
}

export interface LoginCommand {
  /** Identificador de la inmobiliaria. El mismo correo puede estar en varias. */
  readonly tenantSlug: string;
  readonly email: string;
  readonly password: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

export interface LoginResult {
  /** Token en claro. Solo se ve UNA vez: viaja a la cookie y no se guarda. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: AuthenticatedUser;
  readonly tenantSlug: string;
  readonly tenantName: string;
}

export interface SessionService {
  login(command: LoginCommand): Promise<Result<LoginResult, AppError>>;
  /** Valida el token de la cookie. Prorroga la sesión si hay actividad. */
  authenticate(token: string): Promise<Result<AuthenticatedUser, AppError>>;
  logout(token: string): Promise<Result<void, AppError>>;
}
