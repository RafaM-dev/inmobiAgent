/**
 * Vocabulario del catálogo.
 *
 * Es DELIBERADAMENTE independiente del vocabulario de la memoria del cliente
 * (`conversation/domain/value-objects/preferences.ts`, decisión D11). Lo que el
 * cliente dice que quiere y lo que se le pide a un proveedor de inmuebles son
 * dos cosas que hoy se parecen y que divergirán en cuanto un proveedor tenga
 * sus propios filtros. Traducir entre ambos es trabajo explícito de un mapper.
 *
 * Si algún día un proveedor no admite alguno de estos filtros, es su adaptador
 * quien lo resuelve —filtrando en memoria o ignorándolo—, no el agente.
 */

export const CatalogOperation = {
  SALE: "SALE",
  RENT: "RENT",
} as const;
export type CatalogOperation = (typeof CatalogOperation)[keyof typeof CatalogOperation];

export const CatalogPropertyType = {
  APARTMENT: "APARTMENT",
  HOUSE: "HOUSE",
  STUDIO: "STUDIO",
  OFFICE: "OFFICE",
  COMMERCIAL: "COMMERCIAL",
  LOT: "LOT",
  WAREHOUSE: "WAREHOUSE",
  FARM: "FARM",
} as const;
export type CatalogPropertyType =
  (typeof CatalogPropertyType)[keyof typeof CatalogPropertyType];

/** Importe en unidades mínimas de la moneda. Entero, nunca coma flotante. */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export interface PriceRange {
  readonly min?: number;
  readonly max?: number;
  readonly currency: string;
}

export interface AreaRange {
  readonly min?: number;
  readonly max?: number;
}

/**
 * Criterios de búsqueda. Todos opcionales salvo la operación: buscar sin saber
 * si es compra o arriendo devuelve una mezcla que no le sirve a nadie.
 */
export interface SearchCriteria {
  readonly operation: CatalogOperation;
  readonly propertyTypes?: readonly CatalogPropertyType[];
  readonly city?: string;
  readonly neighborhoods?: readonly string[];
  readonly price?: PriceRange;
  readonly bedroomsMin?: number;
  readonly bathroomsMin?: number;
  readonly area?: AreaRange;
  /** Etiquetas libres: "parqueadero", "ascensor", "terraza". */
  readonly features?: readonly string[];
}

/** Paginación por cursor: no asumimos que un proveedor sepa contar páginas. */
export interface CatalogPage {
  readonly limit: number;
  readonly cursor?: string;
}
