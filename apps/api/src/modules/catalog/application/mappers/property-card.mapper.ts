import type { PropertyCardData } from "../../../channels";
import type { PropertySnapshot } from "../../domain/value-objects/property-snapshot";
import { CatalogOperation, type Money } from "../../domain/value-objects/search-criteria";
import type { Property } from "../ports/property-service";

/** Cuántas unidades mínimas tiene una unidad de cada moneda. */
const MINOR_UNITS: Record<string, number> = { COP: 100, USD: 100, EUR: 100, CLP: 1, JPY: 1 };

/**
 * Formatea un importe para que lo lea una persona.
 *
 * En Colombia los precios se dicen en pesos enteros —"450 millones", no
 * "450.000.000,00"—, así que se omiten los decimales cuando no aportan.
 */
export const formatPrice = (price: Money, operation: string): string => {
  const divisor = MINOR_UNITS[price.currency.toUpperCase()] ?? 100;
  const major = Math.round(price.amount / divisor);
  const formatted = major.toLocaleString("es-CO");

  const suffix = operation === CatalogOperation.RENT ? "/mes" : "";
  return price.currency === "COP" ? `$${formatted}${suffix}` : `${formatted} ${price.currency}${suffix}`;
};

const locationOf = (city: string, neighborhood?: string): string =>
  neighborhood ? `${neighborhood}, ${city}` : city;

const attributesOf = (input: {
  bedrooms?: number;
  bathrooms?: number;
  areaM2?: number;
}): { label: string; value: string }[] => {
  const attributes: { label: string; value: string }[] = [];
  if (input.bedrooms !== undefined && input.bedrooms > 0) {
    attributes.push({ label: "Habitaciones", value: String(input.bedrooms) });
  }
  if (input.bathrooms !== undefined && input.bathrooms > 0) {
    attributes.push({ label: "Baños", value: String(input.bathrooms) });
  }
  if (input.areaM2 !== undefined) {
    attributes.push({ label: "Área", value: `${String(input.areaM2)} m²` });
  }
  return attributes;
};

/**
 * Inmueble → ficha para el cliente.
 *
 * ESTA función es la defensa práctica contra la alucinación de precios (docs
 * §7.3, paso 5). El precio, el área y las habitaciones de una ficha salen SIEMPRE
 * de aquí, es decir, de los datos que devolvió una herramienta. El modelo
 * redacta la frase que acompaña; los números no los escribe nunca.
 */
export const toPropertyCard = (
  property: Property,
  extras: { imageUrl?: string; url?: string } = {},
): PropertyCardData => ({
  reference: property.ref.key,
  title: property.title,
  price: formatPrice(property.price, property.operation),
  location: locationOf(property.city, property.neighborhood),
  ...(property.description ? { summary: property.description } : {}),
  attributes: attributesOf(property),
  ...(extras.imageUrl ? { imageUrl: extras.imageUrl } : {}),
  ...(extras.url ? { url: extras.url } : {}),
});

/** Ficha desde una copia guardada: lo que el cliente vio, no lo que hay hoy. */
export const snapshotToCard = (snapshot: PropertySnapshot): PropertyCardData => ({
  reference: snapshot.ref.key,
  title: snapshot.title,
  price: formatPrice(snapshot.price, snapshot.operation),
  location: locationOf(snapshot.city, snapshot.neighborhood),
  attributes: attributesOf({
    ...(snapshot.bedrooms !== undefined ? { bedrooms: snapshot.bedrooms } : {}),
    ...(snapshot.bathrooms !== undefined ? { bathrooms: snapshot.bathrooms } : {}),
    ...(snapshot.areaM2 !== undefined ? { areaM2: snapshot.areaM2 } : {}),
  }),
  ...(snapshot.imageUrl ? { imageUrl: snapshot.imageUrl } : {}),
  ...(snapshot.url ? { url: snapshot.url } : {}),
});
