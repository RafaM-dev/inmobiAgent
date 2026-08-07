import { DomainError } from "../../../../platform/errors/app-error";

/**
 * Identidad de un inmueble que NO es nuestro.
 *
 * Este value object es la pieza central del principio 3: no somos dueños del
 * catálogo. Un inmueble se identifica por el proveedor que lo publica
 * (`source`) y por el identificador que ese proveedor le da (`externalId`).
 * Nada más. No hay un `propertyId` nuestro, porque crearlo nos obligaría a
 * mantener una tabla de inmuebles que dejaría de ser cierta en cuanto la
 * inmobiliaria cambiara de CRM.
 *
 * Un lead o una cita pueden referirse a un inmueble para siempre guardando
 * solo estos dos strings.
 */
export interface PropertyRefProps {
  /** Proveedor del catálogo. Opaco: no interpretamos su valor. */
  readonly source: string;
  readonly externalId: string;
}

export class PropertyRef {
  private constructor(private readonly props: PropertyRefProps) {}

  static create(source: string, externalId: string): PropertyRef {
    const cleanSource = source.trim().toLowerCase();
    const cleanId = externalId.trim();

    if (cleanSource.length === 0) {
      throw new DomainError("La referencia de inmueble necesita un proveedor");
    }
    if (cleanId.length === 0) {
      throw new DomainError("La referencia de inmueble necesita un identificador externo");
    }

    return new PropertyRef({ source: cleanSource, externalId: cleanId });
  }

  /** Reconstruye desde `"mock:APT-0042"`. Formato solo de transporte. */
  static parse(key: string): PropertyRef {
    const separator = key.indexOf(":");
    if (separator <= 0) {
      throw new DomainError("Referencia de inmueble mal formada", { key });
    }
    return PropertyRef.create(key.slice(0, separator), key.slice(separator + 1));
  }

  get source(): string {
    return this.props.source;
  }
  get externalId(): string {
    return this.props.externalId;
  }

  /** Clave estable para índices, mapas y argumentos de herramientas. */
  get key(): string {
    return `${this.props.source}:${this.props.externalId}`;
  }

  equals(other: PropertyRef): boolean {
    return this.props.source === other.source && this.props.externalId === other.externalId;
  }

  toJSON(): PropertyRefProps {
    return { ...this.props };
  }
}
