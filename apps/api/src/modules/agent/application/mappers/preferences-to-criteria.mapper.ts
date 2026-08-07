import {
  CatalogOperation,
  CatalogPropertyType,
  type SearchCriteria,
} from "../../../catalog";
import type { ProfileSlots } from "../../../conversation";

/**
 * Traduce lo que el cliente dijo que quiere a lo que se le pide al catálogo.
 *
 * Este mapper es la decisión D11 hecha código: la memoria del cliente y los
 * criterios de un proveedor son dos vocabularios distintos, y traducir entre
 * ellos es trabajo explícito. Si mañana un proveedor llama "estrato" a algo o
 * mide el área en varas, el destrozo se queda aquí dentro y no llega ni al
 * agente ni a la memoria.
 *
 * Regla de conversión de presupuesto: un cliente que dice "hasta 450 millones"
 * está poniendo un techo, no un objetivo. Se traduce tal cual, sin ampliarlo
 * "por si acaso": enseñar algo por encima de su presupuesto es la forma más
 * rápida de perder su confianza.
 */

type CatalogType = NonNullable<SearchCriteria["propertyTypes"]>[number];

const TYPE_MAP: Record<string, CatalogType> = {
  APARTMENT: CatalogPropertyType.APARTMENT,
  HOUSE: CatalogPropertyType.HOUSE,
  STUDIO: CatalogPropertyType.STUDIO,
  OFFICE: CatalogPropertyType.OFFICE,
  COMMERCIAL: CatalogPropertyType.COMMERCIAL,
  LOT: CatalogPropertyType.LOT,
  WAREHOUSE: CatalogPropertyType.WAREHOUSE,
  FARM: CatalogPropertyType.FARM,
};

const valueOf = (slots: Readonly<ProfileSlots>, name: keyof ProfileSlots): unknown =>
  (slots[name] as { value: unknown } | undefined)?.value;

/**
 * `null` cuando no hay operación: sin saber si compra o arrienda, buscar
 * devuelve una mezcla inservible. Es justo el dato que la política de
 * descubrimiento pregunta primero.
 */
export const toSearchCriteria = (slots: Readonly<ProfileSlots>): SearchCriteria | null => {
  const operation = valueOf(slots, "operation");
  if (operation !== CatalogOperation.SALE && operation !== CatalogOperation.RENT) return null;

  const rawTypes = (valueOf(slots, "propertyType") ?? []) as string[];
  const propertyTypes = rawTypes
    .map((type) => TYPE_MAP[type])
    .filter((type): type is CatalogType => type !== undefined);

  const city = valueOf(slots, "city") as string | undefined;
  const neighborhoods = valueOf(slots, "neighborhoods") as string[] | undefined;
  const budget = valueOf(slots, "budget") as SearchCriteria["price"] | undefined;
  const bedrooms = valueOf(slots, "bedrooms") as number | undefined;
  const bathrooms = valueOf(slots, "bathrooms") as number | undefined;
  const features = valueOf(slots, "features") as string[] | undefined;

  return {
    operation,
    ...(propertyTypes.length > 0 ? { propertyTypes } : {}),
    ...(city ? { city } : {}),
    ...(neighborhoods && neighborhoods.length > 0 ? { neighborhoods } : {}),
    ...(budget ? { price: budget } : {}),
    ...(bedrooms !== undefined ? { bedroomsMin: bedrooms } : {}),
    ...(bathrooms !== undefined ? { bathroomsMin: bathrooms } : {}),
    ...(features && features.length > 0 ? { features } : {}),
  };
};
