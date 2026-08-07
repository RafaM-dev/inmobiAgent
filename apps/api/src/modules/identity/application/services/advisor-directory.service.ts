import type { User } from "../../domain/entities/user";
import type { UserRepository } from "../../domain/repositories/user.repository";
import type { AdvisorDirectory, AdvisorView } from "../ports/advisor-directory";

const toView = (user: User): AdvisorView => ({
  id: user.id,
  displayName: user.displayName,
  email: user.email,
});

/**
 * Implementación sobre el repositorio de usuarios.
 *
 * `canReceiveConversations` ya es una invariante del agregado `User` (rol de
 * asesor o superior, y activo): aquí no se reimplementa esa regla, se usa. Un
 * VIEWER no recibe leads porque el dominio de identidad lo dice, no porque el
 * módulo de leads lo recuerde.
 *
 * Sin caché, a diferencia de `TenantDirectory`: la plantilla de una inmobiliaria
 * cambia poco pero se consulta poco también —solo al asignar—, y una lista de
 * asesores rancia repartiría trabajo a alguien que acaba de irse.
 */
export class AdvisorDirectoryService implements AdvisorDirectory {
  constructor(private readonly deps: { users: UserRepository }) {}

  async listAssignable(): Promise<readonly AdvisorView[]> {
    const users = await this.deps.users.listByTenant();
    return users
      .filter((user) => user.canReceiveConversations)
      .map(toView)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async findById(userId: string): Promise<AdvisorView | null> {
    const user = await this.deps.users.findById(userId);
    return user ? toView(user) : null;
  }
}
