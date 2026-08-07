import type { Session } from "../entities/session";

/**
 * Persistencia de sesiones.
 *
 * NO lleva ámbito de tenant: la sesión es lo que RESUELVE el tenant, así que
 * exigirlo por adelantado sería circular. La búsqueda es por el hash del token,
 * que es único en toda la plataforma, y el `tenantId` sale de la fila.
 */
export interface SessionRepository {
  save(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  /** Cierra todas las sesiones de una persona. Al cambiar contraseña o al salir. */
  revokeAllForUser(userId: string, now: Date): Promise<void>;
  /** Limpieza: las sesiones caducadas no sirven ni para auditar. */
  deleteExpired(before: Date): Promise<number>;
}
