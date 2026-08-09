import type { UserToken, UserTokenPurpose } from "../entities/user-token";

/**
 * Persistencia de enlaces de un solo uso.
 *
 * NO lleva ámbito de tenant, por la misma razón que las sesiones: quien abre un
 * enlace de invitación no tiene sesión, así que es el propio token el que
 * resuelve a qué inmobiliaria pertenece. Exigir el contexto antes sería
 * circular. La búsqueda es por el hash, que es único en toda la plataforma.
 */
export interface UserTokenRepository {
  save(token: UserToken): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<UserToken | null>;
  /**
   * Invalida los que siguieran vivos para esa persona y ese propósito.
   *
   * Pedir un segundo enlace de recuperación tiene que dejar sin valor al
   * primero: si no, el correo antiguo —que puede haber acabado en cualquier
   * sitio— seguiría abriendo la cuenta.
   */
  invalidateOpen(userId: string, purpose: UserTokenPurpose, now: Date): Promise<void>;
  /** Limpieza: los caducados no sirven ni para auditar. */
  deleteExpired(before: Date): Promise<number>;
}
