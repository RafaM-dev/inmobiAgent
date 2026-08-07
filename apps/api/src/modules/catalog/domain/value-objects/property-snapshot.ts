import { createHash } from "node:crypto";
import type { CatalogOperation, CatalogPropertyType, Money } from "./search-criteria";
import type { PropertyRef } from "./property-ref";

export interface PropertySnapshotProps {
  readonly ref: PropertyRef;
  readonly title: string;
  readonly operation: CatalogOperation;
  readonly type: CatalogPropertyType;
  readonly price: Money;
  readonly city: string;
  readonly neighborhood: string | undefined;
  readonly bedrooms: number | undefined;
  readonly bathrooms: number | undefined;
  readonly areaM2: number | undefined;
  readonly imageUrl: string | undefined;
  readonly url: string | undefined;
  readonly capturedAt: Date;
}

/**
 * Copia inmutable de lo que se le mostró a un cliente.
 *
 * Responde a una pregunta que llega tarde o temprano y que sin esto no tiene
 * respuesta: **"¿qué le prometimos exactamente a este cliente?"**. El catálogo
 * del proveedor cambia —los precios suben, los inmuebles se venden—, pero lo
 * que el cliente vio el martes a las 3 de la tarde no puede cambiar.
 *
 * También es lo que permite que un lead o una cita referencien un inmueble sin
 * que nosotros seamos dueños del catálogo: se guarda la referencia y la foto
 * fija de sus datos, no el inmueble.
 *
 * El `checksum` identifica una versión concreta de los datos: si el proveedor
 * sube el precio, el siguiente snapshot es una fila nueva, no un `UPDATE`.
 */
export class PropertySnapshot {
  private constructor(
    private readonly props: PropertySnapshotProps,
    readonly checksum: string,
  ) {}

  static capture(props: PropertySnapshotProps): PropertySnapshot {
    return new PropertySnapshot(props, PropertySnapshot.computeChecksum(props));
  }

  static rehydrate(props: PropertySnapshotProps, checksum: string): PropertySnapshot {
    return new PropertySnapshot(props, checksum);
  }

  /**
   * Huella de los datos que ve el cliente. `capturedAt` queda fuera a
   * propósito: dos capturas idénticas en momentos distintos son el mismo dato,
   * y no queremos una fila nueva por cada vez que se muestra el mismo inmueble.
   */
  private static computeChecksum(props: PropertySnapshotProps): string {
    const material = JSON.stringify([
      props.ref.key,
      props.title,
      props.operation,
      props.type,
      props.price.amount,
      props.price.currency,
      props.city,
      props.neighborhood ?? "",
      props.bedrooms ?? "",
      props.bathrooms ?? "",
      props.areaM2 ?? "",
      props.imageUrl ?? "",
      props.url ?? "",
    ]);
    return createHash("sha256").update(material).digest("hex").slice(0, 32);
  }

  get ref(): PropertyRef {
    return this.props.ref;
  }
  get title(): string {
    return this.props.title;
  }
  get operation(): CatalogOperation {
    return this.props.operation;
  }
  get type(): CatalogPropertyType {
    return this.props.type;
  }
  get price(): Money {
    return this.props.price;
  }
  get city(): string {
    return this.props.city;
  }
  get neighborhood(): string | undefined {
    return this.props.neighborhood;
  }
  get bedrooms(): number | undefined {
    return this.props.bedrooms;
  }
  get bathrooms(): number | undefined {
    return this.props.bathrooms;
  }
  get areaM2(): number | undefined {
    return this.props.areaM2;
  }
  get imageUrl(): string | undefined {
    return this.props.imageUrl;
  }
  get url(): string | undefined {
    return this.props.url;
  }
  get capturedAt(): Date {
    return this.props.capturedAt;
  }

  snapshot(): PropertySnapshotProps {
    return { ...this.props };
  }
}
