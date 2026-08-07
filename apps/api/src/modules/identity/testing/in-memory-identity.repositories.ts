import type { Session } from "../domain/entities/session";
import type { Tenant } from "../domain/entities/tenant";
import type { User } from "../domain/entities/user";
import type { SessionRepository } from "../domain/repositories/session.repository";
import type { TenantRepository } from "../domain/repositories/tenant.repository";
import type { UserRepository } from "../domain/repositories/user.repository";

/**
 * Dobles en memoria de los puertos de persistencia.
 *
 * Existen para que los casos de uso se prueben en milisegundos y sin Postgres.
 * Que sea trivial escribirlos es la señal de que los puertos están bien
 * dimensionados: si un doble en memoria resulta difícil, el puerto está
 * filtrando detalles del ORM.
 */
export class InMemoryTenantRepository implements TenantRepository {
  readonly items = new Map<string, Tenant>();

  findById(id: string): Promise<Tenant | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findBySlug(slug: string): Promise<Tenant | null> {
    for (const tenant of this.items.values()) {
      if (tenant.slug === slug) return Promise.resolve(tenant);
    }
    return Promise.resolve(null);
  }

  save(tenant: Tenant): Promise<void> {
    this.items.set(tenant.id, tenant);
    return Promise.resolve();
  }

  list(limit: number): Promise<Tenant[]> {
    return Promise.resolve([...this.items.values()].slice(0, limit));
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly items = new Map<string, User>();

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    for (const user of this.items.values()) {
      if (user.email === email.toLowerCase()) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findByEmailInTenant(tenantId: string, email: string): Promise<User | null> {
    for (const user of this.items.values()) {
      if (user.tenantId === tenantId && user.email === email.toLowerCase()) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  findByIdUnscoped(id: string): Promise<User | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  listByTenant(): Promise<User[]> {
    return Promise.resolve([...this.items.values()]);
  }

  save(user: User): Promise<void> {
    this.items.set(user.id, user);
    return Promise.resolve();
  }
}

/** Sesiones en memoria. Sin ámbito de tenant, igual que la real. */
export class InMemorySessionRepository implements SessionRepository {
  readonly items = new Map<string, Session>();

  save(session: Session): Promise<void> {
    this.items.set(session.id, session);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    for (const session of this.items.values()) {
      if (session.snapshot().tokenHash === tokenHash) return Promise.resolve(session);
    }
    return Promise.resolve(null);
  }

  revokeAllForUser(userId: string, now: Date): Promise<void> {
    for (const session of this.items.values()) {
      if (session.userId === userId) session.revoke(now);
    }
    return Promise.resolve();
  }

  deleteExpired(before: Date): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.items) {
      if (session.expiresAt.getTime() < before.getTime()) {
        this.items.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}
