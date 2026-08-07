/**
 * Puerto público de `identity` para saber a quién se le puede asignar trabajo.
 *
 * Igual de diminuto que `TenantDirectory` y por el mismo motivo: `leads` no
 * necesita usuarios, roles ni permisos — necesita una lista de personas a las
 * que repartir. Exponer el `UserRepository` habría atado el reparto de leads al
 * modelo de identidad, y ese va a cambiar en F7 cuando llegue la autenticación.
 */

export interface AdvisorView {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface AdvisorDirectory {
  /**
   * Asesores activos del tenant en curso, en orden estable. "Asignable" es una
   * regla de `identity` (rol y estado), no de quien reparte.
   */
  listAssignable(): Promise<readonly AdvisorView[]>;
  findById(userId: string): Promise<AdvisorView | null>;
}
