import type { User } from "../entities/user";

/**
 * Puerto de persistencia de usuarios internos.
 *
 * A diferencia de `TenantRepository`, aquí el `tenantId` es obligatorio en toda
 * consulta: la implementación lo toma del `TenantContext`, no del llamante, de
 * modo que olvidarlo sea imposible (§10.1, defensa en profundidad).
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  listByTenant(): Promise<User[]>;
  save(user: User): Promise<void>;

  /* ------------------------------------------------------------------ *
   * Camino de autenticación
   *
   * Estas dos reciben el `tenantId` EXPLÍCITO porque corren antes de que
   * exista contexto: la sesión es precisamente lo que va a resolverlo, así
   * que exigirlo antes sería circular. Son las únicas del módulo así, y por
   * eso están separadas y con nombre distinto: quien las use fuera del login
   * se está saltando la defensa en profundidad a propósito.
   * ------------------------------------------------------------------ */

  findByEmailInTenant(tenantId: string, email: string): Promise<User | null>;
  findByIdUnscoped(id: string): Promise<User | null>;
}
