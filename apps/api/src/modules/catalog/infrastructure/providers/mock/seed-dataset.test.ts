import { describe, expect, it } from "vitest";
import { isOk } from "../../../../../platform/result/result";
import { CatalogOperation, CatalogPropertyType } from "../../../domain/value-objects/search-criteria";
import { MockPropertyService } from "./mock-property.service";

/**
 * El dataset semilla es parte del producto, no del andamiaje: es lo que ve
 * cualquiera que pruebe el modo demo. Un catálogo que deja vacías las búsquedas
 * más comunes parece un buscador roto.
 *
 * Estos tests fijan la densidad mínima que necesita una demostración creíble.
 * Cuando F3 se escribió, dos consultas obvias devolvían cero: se corrigieron
 * los pesos por ciudad y los umbrales de habitaciones por área.
 */
describe("Dataset semilla — densidad para una demo creíble", () => {
  const service = new MockPropertyService();

  const search = async (criteria: Parameters<MockPropertyService["search"]>[0]) => {
    const result = await service.search(criteria, { limit: 50 });
    if (!isOk(result)) throw new Error("la búsqueda debería funcionar");
    return result.value.items;
  };

  it("«apartamento en arriendo en Medellín, 2 habitaciones, hasta 2 millones»", async () => {
    const items = await search({
      operation: CatalogOperation.RENT,
      city: "Medellín",
      propertyTypes: [CatalogPropertyType.APARTMENT],
      bedroomsMin: 2,
      price: { max: 2_000_000_00, currency: "COP" },
    });

    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("«apartamento en venta en Medellín hasta 450 millones»", async () => {
    const items = await search({
      operation: CatalogOperation.SALE,
      city: "Medellín",
      propertyTypes: [CatalogPropertyType.APARTMENT],
      price: { max: 450_000_000_00, currency: "COP" },
    });

    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("«casa en venta en Bogotá»", async () => {
    const items = await search({
      operation: CatalogOperation.SALE,
      city: "Bogotá",
      propertyTypes: [CatalogPropertyType.HOUSE],
    });

    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("hay inventario suficiente en el mercado principal", async () => {
    const rent = await search({ operation: CatalogOperation.RENT, city: "Medellín" });
    const sale = await search({ operation: CatalogOperation.SALE, city: "Medellín" });

    // Una inmobiliaria concentra su cartera donde opera.
    expect(rent.length).toBeGreaterThanOrEqual(10);
    expect(sale.length).toBeGreaterThanOrEqual(10);
  });

  it("los apartamentos compactos tienen las alcobas que tendrían aquí", async () => {
    const items = await search({
      operation: CatalogOperation.RENT,
      propertyTypes: [CatalogPropertyType.APARTMENT],
    });

    const compact = items.filter((p) => (p.areaM2 ?? 0) >= 50 && (p.areaM2 ?? 0) < 75);
    expect(compact.length).toBeGreaterThan(0);
    for (const property of compact) {
      expect(property.bedrooms).toBe(2);
    }
  });
});
