import { DomainError } from "../../../../platform/errors/app-error";

export const UserTokenPurpose = {
  /** Alta de un asesor: entra por primera vez y elige contraseña. */
  INVITATION: "INVITATION",
  /** Recuperación: ya tenía cuenta y no puede entrar. */
  PASSWORD_RESET: "PASSWORD_RESET",
} as const;
export type UserTokenPurpose = (typeof UserTokenPurpose)[keyof typeof UserTokenPurpose];

/**
 * Cuánto vive cada tipo de enlace.
 *
 * La invitación dura días porque quien la recibe puede estar de vacaciones. El
 * restablecimiento dura una hora porque se pide justo cuando se va a usar, y
 * porque un enlace que abre una cuenta no debería seguir vivo en la bandeja de
 * entrada de nadie una semana después.
 */
export const TOKEN_TTL_MS: Record<UserTokenPurpose, number> = {
  INVITATION: 7 * 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

export interface UserTokenProps {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly purpose: UserTokenPurpose;
  /** Solo el hash. El token en claro vive únicamente en el correo enviado. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly usedAt?: Date;
  readonly createdAt: Date;
}

/**
 * Enlace de un solo uso.
 *
 * El agregado no genera ni conoce el token en claro: recibe su hash. Generar
 * bytes aleatorios es una decisión criptográfica del kernel, no del dominio —
 * el mismo reparto que ya tiene la contraseña.
 */
export class UserToken {
  private constructor(private props: UserTokenProps) {}

  static issue(input: {
    id: string;
    tenantId: string;
    userId: string;
    purpose: UserTokenPurpose;
    tokenHash: string;
    now: Date;
  }): UserToken {
    if (input.tokenHash.length === 0) {
      throw new DomainError("El token no puede estar vacío");
    }

    return new UserToken({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: new Date(input.now.getTime() + TOKEN_TTL_MS[input.purpose]),
      createdAt: input.now,
    });
  }

  static rehydrate(props: UserTokenProps): UserToken {
    return new UserToken(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get purpose(): UserTokenPurpose {
    return this.props.purpose;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get usedAt(): Date | undefined {
    return this.props.usedAt;
  }

  isUsable(now: Date): boolean {
    return this.props.usedAt === undefined && this.props.expiresAt.getTime() > now.getTime();
  }

  /**
   * Marca el token como consumido.
   *
   * No se borra la fila: conservarla permite responder «este enlace ya se usó»
   * en vez de «este enlace no existe», y deja rastro de cuándo entró cada
   * persona. Borrarla ahorraría unos bytes y perdería las dos cosas.
   */
  consume(now: Date): void {
    if (!this.isUsable(now)) {
      throw new DomainError("El token ya no es válido", { tokenId: this.props.id });
    }
    this.props = { ...this.props, usedAt: now };
  }

  snapshot(): UserTokenProps {
    return { ...this.props };
  }
}
