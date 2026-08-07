import { DomainError } from "../../../../platform/errors/app-error";

export interface SessionProps {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  /** SHA-256 del token. El token en claro solo existe en el navegador. */
  readonly tokenHash: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

/**
 * Sesión del back-office.
 *
 * Opaca y en servidor, no un JWT (decisión D34). La diferencia se nota el día
 * que hay que echar a alguien: una sesión se revoca y deja de funcionar en la
 * siguiente petición; un token firmado sigue siendo válido hasta que caduque,
 * y no hay forma de retirarlo sin montar precisamente la lista de revocación
 * que el JWT venía a evitar.
 */
export class Session {
  private constructor(private props: SessionProps) {}

  static issue(input: {
    id: string;
    tenantId: string;
    userId: string;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    ttlMs: number;
    now: Date;
  }): Session {
    if (input.ttlMs <= 0) throw new DomainError("La sesión necesita una duración positiva");

    return new Session({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: new Date(input.now.getTime() + input.ttlMs),
    });
  }

  static rehydrate(props: SessionProps): Session {
    return new Session(props);
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
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get lastSeenAt(): Date {
    return this.props.lastSeenAt;
  }

  isValidAt(now: Date): boolean {
    if (this.props.revokedAt !== undefined) return false;
    return this.props.expiresAt.getTime() > now.getTime();
  }

  /**
   * Marca actividad y, si la sesión está cerca de caducar, la prorroga.
   *
   * La prórroga es deslizante para que a un asesor no se le cierre la sesión a
   * mitad de una conversación con un cliente. El tope absoluto lo pone quien
   * llama; aquí solo se extiende mientras haya actividad.
   */
  touch(now: Date, ttlMs: number): boolean {
    const halfLife = this.props.expiresAt.getTime() - ttlMs / 2;
    const shouldExtend = now.getTime() > halfLife;

    this.props = {
      ...this.props,
      lastSeenAt: now,
      ...(shouldExtend ? { expiresAt: new Date(now.getTime() + ttlMs) } : {}),
    };

    return shouldExtend;
  }

  revoke(now: Date): void {
    if (this.props.revokedAt !== undefined) return;
    this.props = { ...this.props, revokedAt: now };
  }

  snapshot(): SessionProps {
    return { ...this.props };
  }
}
