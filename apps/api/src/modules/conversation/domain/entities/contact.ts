import { DomainError } from "../../../../platform/errors/app-error";

/** Un texto en blanco es "no lo sabemos", no un valor vacío. */
const cleanOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

export interface ContactProps {
  readonly id: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly primaryPhone: string | undefined;
  readonly email: string | undefined;
  readonly locale: string;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * El cliente final: la persona que escribe buscando un inmueble.
 *
 * Es distinto de la *identidad* con la que escribe (§ `ContactIdentity`): la
 * misma persona puede llegar por WhatsApp hoy e Instagram mañana y debe ser el
 * mismo contacto, con la misma memoria. Por eso el teléfono no es la clave.
 */
export class Contact {
  private constructor(private props: ContactProps) {}

  static create(input: {
    id: string;
    tenantId: string;
    displayName?: string | undefined;
    primaryPhone?: string | undefined;
    email?: string | undefined;
    locale?: string | undefined;
    now: Date;
  }): Contact {
    const displayName = input.displayName?.trim();
    return new Contact({
      id: input.id,
      tenantId: input.tenantId,
      // Sin nombre todavía: el agente lo preguntará y lo actualizará.
      displayName: displayName && displayName.length > 0 ? displayName : "Cliente",
      primaryPhone: cleanOptional(input.primaryPhone),
      email: cleanOptional(input.email)?.toLowerCase(),
      locale: input.locale ?? "es-CO",
      tags: [],
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: ContactProps): Contact {
    return new Contact(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get primaryPhone(): string | undefined {
    return this.props.primaryPhone;
  }
  get email(): string | undefined {
    return this.props.email;
  }
  get locale(): string {
    return this.props.locale;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }

  rename(displayName: string, now: Date): void {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) throw new DomainError("El nombre del contacto no puede ser vacío");
    this.props = { ...this.props, displayName: trimmed, updatedAt: now };
  }

  setEmail(email: string, now: Date): void {
    this.props = { ...this.props, email: email.trim().toLowerCase(), updatedAt: now };
  }

  setPhone(phone: string, now: Date): void {
    this.props = { ...this.props, primaryPhone: phone.trim(), updatedAt: now };
  }

  addTag(tag: string, now: Date): void {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0 || this.props.tags.includes(normalized)) return;
    this.props = { ...this.props, tags: [...this.props.tags, normalized], updatedAt: now };
  }

  snapshot(): ContactProps {
    return { ...this.props };
  }
}
