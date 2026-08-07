import { DomainError } from "../../../../platform/errors/app-error";

/**
 * Rol dentro de la inmobiliaria. Ordenados de mayor a menor privilegio: la
 * comparación por índice evita una tabla de permisos prematura.
 */
export const UserRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  AGENT: "AGENT",
  VIEWER: "VIEWER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

const ROLE_RANK: Record<UserRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  AGENT: 1,
  VIEWER: 0,
};

export const UserStatus = {
  ACTIVE: "ACTIVE",
  INVITED: "INVITED",
  DISABLED: "DISABLED",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface UserProps {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  /** `scrypt$…`. Ausente mientras el usuario está invitado y no ha entrado. */
  readonly passwordHash?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Usuario interno: asesor o administrador de la inmobiliaria. No es el cliente
 * final — ese es un `Contact` del módulo `conversation`.
 *
 * En F1 no hay autenticación (se decide en F7, ver §18). El usuario existe
 * porque los leads se asignan a un asesor y el handoff necesita a quién avisar.
 */
export class User {
  private constructor(private props: UserProps) {}

  static create(input: {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    role?: UserRole;
    status?: UserStatus;
    now: Date;
  }): User {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new DomainError("Correo electrónico inválido", { email: input.email });
    }

    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw new DomainError("El nombre del usuario no puede estar vacío");
    }

    return new User({
      id: input.id,
      tenantId: input.tenantId,
      email,
      displayName,
      role: input.role ?? UserRole.AGENT,
      status: input.status ?? UserStatus.INVITED,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get email(): string {
    return this.props.email;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get role(): UserRole {
    return this.props.role;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get passwordHash(): string | undefined {
    return this.props.passwordHash;
  }

  get canReceiveConversations(): boolean {
    return this.props.status === UserStatus.ACTIVE && ROLE_RANK[this.props.role] >= ROLE_RANK.AGENT;
  }

  /**
   * ¿Puede entrar al back-office?
   *
   * Un usuario invitado o desactivado NO entra aunque acierte la contraseña:
   * desactivar a alguien tiene que cerrarle la puerta, no solo quitarle
   * conversaciones.
   */
  get canSignIn(): boolean {
    return this.props.status === UserStatus.ACTIVE && this.props.passwordHash !== undefined;
  }

  /**
   * Fija la contraseña ya hasheada. El agregado NUNCA ve la contraseña en
   * claro: hashear es una decisión criptográfica del kernel, no del dominio.
   *
   * Fijar contraseña activa a un usuario invitado: es exactamente lo que
   * significa aceptar una invitación.
   */
  setPasswordHash(hash: string, now: Date): void {
    if (hash.length === 0) throw new DomainError("El hash de contraseña no puede estar vacío");

    this.props = {
      ...this.props,
      passwordHash: hash,
      ...(this.props.status === UserStatus.INVITED ? { status: UserStatus.ACTIVE } : {}),
      updatedAt: now,
    };
  }

  hasAtLeast(role: UserRole): boolean {
    return ROLE_RANK[this.props.role] >= ROLE_RANK[role];
  }

  activate(now: Date): void {
    this.props = { ...this.props, status: UserStatus.ACTIVE, updatedAt: now };
  }

  disable(now: Date): void {
    if (this.props.role === UserRole.OWNER) {
      throw new DomainError("No se puede desactivar al propietario de la cuenta", {
        userId: this.props.id,
      });
    }
    this.props = { ...this.props, status: UserStatus.DISABLED, updatedAt: now };
  }

  changeRole(role: UserRole, now: Date): void {
    this.props = { ...this.props, role, updatedAt: now };
  }

  snapshot(): UserProps {
    return { ...this.props };
  }
}
