import { DomainError } from "../../../../platform/errors/app-error";
import { TenantSettings } from "../value-objects/tenant-settings";

export const TenantStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const TenantPlan = {
  TRIAL: "TRIAL",
  STARTER: "STARTER",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;
export type TenantPlan = (typeof TenantPlan)[keyof typeof TenantPlan];

export interface TenantProps {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly plan: TenantPlan;
  readonly locale: string;
  readonly timezone: string;
  readonly currency: string;
  readonly settings: TenantSettings;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** kebab-case: es la clave humana del tenant en URLs y en el CLI. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** ISO 4217. No validamos contra una lista: cambian y no somos su fuente. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Tenant: la inmobiliaria. Agregado raíz de `identity` y frontera de todo dato
 * del sistema — no existe una sola tabla de negocio sin su `tenantId`.
 *
 * Las invariantes se validan en `create`/`rehydrate`, nunca en el repositorio:
 * es imposible tener en memoria un Tenant inválido.
 */
export class Tenant {
  private constructor(private props: TenantProps) {}

  static create(input: {
    id: string;
    slug: string;
    name: string;
    plan?: TenantPlan;
    locale?: string;
    timezone?: string;
    currency?: string;
    settings?: TenantSettings;
    now: Date;
  }): Tenant {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      throw new DomainError(
        "El identificador del tenant debe ser kebab-case (ej. inmobiliaria-medellin)",
        { slug: input.slug },
      );
    }

    const name = input.name.trim();
    if (name.length < 2) {
      throw new DomainError("El nombre del tenant es demasiado corto", { name: input.name });
    }

    const currency = (input.currency ?? "COP").toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new DomainError("La moneda debe ser un código ISO 4217 de 3 letras", { currency });
    }

    return new Tenant({
      id: input.id,
      slug,
      name,
      status: TenantStatus.ACTIVE,
      plan: input.plan ?? TenantPlan.TRIAL,
      locale: input.locale ?? "es-CO",
      timezone: input.timezone ?? "America/Bogota",
      currency,
      settings: input.settings ?? TenantSettings.create(),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstrucción desde persistencia. No re-aplica reglas de creación. */
  static rehydrate(props: TenantProps): Tenant {
    return new Tenant(props);
  }

  get id(): string {
    return this.props.id;
  }
  get slug(): string {
    return this.props.slug;
  }
  get name(): string {
    return this.props.name;
  }
  get status(): TenantStatus {
    return this.props.status;
  }
  get plan(): TenantPlan {
    return this.props.plan;
  }
  get locale(): string {
    return this.props.locale;
  }
  get timezone(): string {
    return this.props.timezone;
  }
  get currency(): string {
    return this.props.currency;
  }
  get settings(): TenantSettings {
    return this.props.settings;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isActive(): boolean {
    return this.props.status === TenantStatus.ACTIVE;
  }

  rename(name: string, now: Date): void {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new DomainError("El nombre del tenant es demasiado corto", { name });
    }
    this.props = { ...this.props, name: trimmed, updatedAt: now };
  }

  updateSettings(settings: TenantSettings, now: Date): void {
    this.props = { ...this.props, settings, updatedAt: now };
  }

  changePlan(plan: TenantPlan, now: Date): void {
    this.props = { ...this.props, plan, updatedAt: now };
  }

  suspend(now: Date): void {
    if (this.props.status === TenantStatus.SUSPENDED) return;
    this.props = { ...this.props, status: TenantStatus.SUSPENDED, updatedAt: now };
  }

  activate(now: Date): void {
    if (this.props.status === TenantStatus.ACTIVE) return;
    this.props = { ...this.props, status: TenantStatus.ACTIVE, updatedAt: now };
  }

  snapshot(): TenantProps {
    return { ...this.props };
  }
}
