/**
 * Vocabulario de lo que el cliente busca.
 *
 * Nota de diseño: esto NO es `SearchCriteria` del catálogo (F3). Aquí vive lo
 * que el cliente *dijo que quiere*; allí vivirá lo que se le *pide a un
 * proveedor de inmuebles*. Son dos conceptos que hoy se parecen y que
 * divergirán en cuanto un proveedor tenga sus propios filtros. Traducir de uno
 * a otro será trabajo explícito de un mapper, no un tipo compartido a la fuerza:
 * es lo que impide que el vocabulario de un proveedor externo se cuele en la
 * memoria del cliente.
 */

export const PropertyOperation = {
  SALE: "SALE",
  RENT: "RENT",
} as const;
export type PropertyOperation = (typeof PropertyOperation)[keyof typeof PropertyOperation];

export const PropertyKind = {
  APARTMENT: "APARTMENT",
  HOUSE: "HOUSE",
  STUDIO: "STUDIO",
  OFFICE: "OFFICE",
  COMMERCIAL: "COMMERCIAL",
  LOT: "LOT",
  WAREHOUSE: "WAREHOUSE",
  FARM: "FARM",
} as const;
export type PropertyKind = (typeof PropertyKind)[keyof typeof PropertyKind];

/**
 * Importes en **unidades mínimas** de la moneda (centavos para COP y USD),
 * siempre enteros. Nunca se guarda un decimal en coma flotante: 450 millones
 * de pesos son 45 000 000 000, no 450000000.0.
 *
 * Es la misma convención que el paquete `contracts` usa en la API, para que un
 * importe no cambie de significado al cruzar una frontera.
 */
export interface MoneyRange {
  readonly min?: number;
  readonly max?: number;
  readonly currency: string;
}

/** Cuántas unidades mínimas tiene una unidad de cada moneda. */
const MINOR_UNITS: Record<string, number> = { COP: 100, USD: 100, EUR: 100, CLP: 1, JPY: 1 };

/** `moneyFromMajor(450_000_000, "COP")` → 45 000 000 000 centavos. */
export const moneyFromMajor = (amount: number, currency: string): number =>
  Math.round(amount * (MINOR_UNITS[currency.toUpperCase()] ?? 100));

/** Inverso del anterior. Para mostrar, nunca para calcular. */
export const moneyToMajor = (minor: number, currency: string): number =>
  minor / (MINOR_UNITS[currency.toUpperCase()] ?? 100);

export interface NumberRange {
  readonly min?: number;
  readonly max?: number;
}

export const Timeline = {
  NOW: "now",
  ONE_TO_THREE_MONTHS: "1-3m",
  THREE_TO_SIX_MONTHS: "3-6m",
  EXPLORING: "exploring",
} as const;
export type Timeline = (typeof Timeline)[keyof typeof Timeline];

export const Financing = {
  CASH: "cash",
  MORTGAGE: "mortgage",
  UNKNOWN: "unknown",
} as const;
export type Financing = (typeof Financing)[keyof typeof Financing];

/** Consentimiento para tratamiento de datos y contacto comercial. */
export interface ConsentState {
  readonly dataProcessing: boolean;
  readonly marketing: boolean;
  readonly grantedAt?: string;
}
