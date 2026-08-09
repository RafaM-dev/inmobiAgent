import type {
  Session as PrismaSession,
  Tenant as PrismaTenant,
  User as PrismaUser,
} from "@prisma/client";
import { InvariantViolationError } from "../../../../../platform/errors/app-error";
import { Session } from "../../../domain/entities/session";
import { Tenant } from "../../../domain/entities/tenant";
import { User } from "../../../domain/entities/user";
import { TenantSettings } from "../../../domain/value-objects/tenant-settings";

/**
 * Traducción fila ⇄ agregado.
 *
 * Aislar esto en un archivo tiene un objetivo concreto: el día que cambie el
 * esquema o el ORM, el dominio no se entera. Es el único punto del módulo que
 * conoce las dos formas del mismo concepto.
 */

const toSettings = (raw: unknown): TenantSettings => {
  if (raw === null || typeof raw !== "object") {
    throw new InvariantViolationError("El tenant no tiene settings válidos en base de datos");
  }
  return TenantSettings.create(raw);
};

export const tenantToDomain = (row: PrismaTenant): Tenant =>
  Tenant.rehydrate({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
    locale: row.locale,
    timezone: row.timezone,
    currency: row.currency,
    settings: toSettings(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export const tenantToPersistence = (tenant: Tenant) => {
  const s = tenant.snapshot();
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    status: s.status,
    plan: s.plan,
    locale: s.locale,
    timezone: s.timezone,
    currency: s.currency,
    // `toJSON` descarta los `undefined`, que Prisma no admite dentro de Json.
    settings: JSON.parse(JSON.stringify(s.settings.toJSON())) as object,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
};

export const userToDomain = (row: PrismaUser): User =>
  User.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    ...(row.passwordHash !== null ? { passwordHash: row.passwordHash } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export const userToPersistence = (user: User) => {
  const s = user.snapshot();
  return { ...s, passwordHash: s.passwordHash ?? null };
};

export const sessionToDomain = (row: PrismaSession): Session =>
  Session.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    tokenHash: row.tokenHash,
    ...(row.userAgent !== null ? { userAgent: row.userAgent } : {}),
    ...(row.ipAddress !== null ? { ipAddress: row.ipAddress } : {}),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    ...(row.revokedAt !== null ? { revokedAt: row.revokedAt } : {}),
  });

export const sessionToPersistence = (session: Session) => {
  const s = session.snapshot();
  return {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId,
    tokenHash: s.tokenHash,
    userAgent: s.userAgent ?? null,
    ipAddress: s.ipAddress ?? null,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt ?? null,
  };
};
