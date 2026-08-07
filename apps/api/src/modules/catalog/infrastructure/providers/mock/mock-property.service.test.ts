import { describe, expect, it } from "vitest";
import { isOk } from "../../../../../platform/result/result";
import { CatalogOperation, CatalogPropertyType } from "../../../domain/value-objects/search-criteria";
import { describePropertyServiceContract } from "../../../testing/property-service.contract";
import { MockPropertyService } from "./mock-property.service";

const create = (): MockPropertyService => new MockPropertyService();

// El mock cumple el mismo contrato que cumplirá cualquier proveedor real.
describePropertyServiceContract("MockPropertyService", create);

describe("MockPropertyService — el catálogo del modo demo", () => {
  it("es determinista: dos instancias tienen exactamente el mismo catálogo", async () => {
    const first = await create().search({ operation: CatalogOperation.SALE }, { limit: 20 });
    const second = await create().search({ operation: CatalogOperation.SALE }, { limit: 20 });

    if (!isOk(first) || !isOk(second)) throw new Error("debería buscar");
    expect(first.value.items.map((p) => p.ref.key)).toEqual(
      second.value.items.map((p) => p.ref.key),
    );
    expect(first.value.items[0]?.price.amount).toBe(second.value.items[0]?.price.amount);
  });

  it("tiene inventario suficiente en las ciudades principales", async () => {
    for (const city of ["Medellín", "Bogotá", "Cali"]) {
      const result = await create().search({ operation: CatalogOperation.SALE, city }, { limit: 50 });
      if (!isOk(result)) throw new Error("debería buscar");
      expect(result.value.items.length).toBeGreaterThan(0);
    }
  });

  it("filtra por barrio sin que importen las tildes", async () => {
    const result = await create().search(
      { operation: CatalogOperation.SALE, city: "Medellín", neighborhoods: ["el poblado"] },
      { limit: 20 },
    );

    if (!isOk(result)) throw new Error("debería buscar");
    expect(result.value.items.length).toBeGreaterThan(0);
    for (const property of result.value.items) {
      expect(property.neighborhood).toBe("El Poblado");
    }
  });

  it("combina varios criterios a la vez", async () => {
    const result = await create().search(
      {
        operation: CatalogOperation.RENT,
        city: "Medellín",
        propertyTypes: [CatalogPropertyType.APARTMENT],
        bedroomsMin: 2,
        price: { max: 4_000_000_00, currency: "COP" },
      },
      { limit: 20 },
    );

    if (!isOk(result)) throw new Error("debería buscar");
    for (const property of result.value.items) {
      expect(property.operation).toBe("RENT");
      expect(property.city).toBe("Medellín");
      expect(property.type).toBe("APARTMENT");
      expect(property.bedrooms ?? 0).toBeGreaterThanOrEqual(2);
      expect(property.price.amount).toBeLessThanOrEqual(4_000_000_00);
    }
  });

  it("exige que estén TODAS las características pedidas, no una cualquiera", async () => {
    const result = await create().search(
      { operation: CatalogOperation.SALE, features: ["parqueadero", "ascensor"] },
      { limit: 20 },
    );

    if (!isOk(result)) throw new Error("debería buscar");
    expect(result.value.items.length).toBeGreaterThan(0);
    for (const property of result.value.items) {
      expect(property.features).toContain("parqueadero");
      expect(property.features).toContain("ascensor");
    }
  });

  it("ordena de más barato a más caro dentro de lo pedido", async () => {
    const result = await create().search({ operation: CatalogOperation.RENT }, { limit: 15 });

    if (!isOk(result)) throw new Error("debería buscar");
    const prices = result.value.items.map((p) => p.price.amount);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("los precios son verosímiles para el mercado colombiano", async () => {
    const sale = await create().search({ operation: CatalogOperation.SALE }, { limit: 50 });
    const rent = await create().search({ operation: CatalogOperation.RENT }, { limit: 50 });

    if (!isOk(sale) || !isOk(rent)) throw new Error("debería buscar");

    // Venta: entre 80 millones y 5 000 millones de pesos.
    for (const property of sale.value.items) {
      expect(property.price.amount).toBeGreaterThan(80_000_000_00);
      expect(property.price.amount).toBeLessThan(5_000_000_000_00);
    }
    // Arriendo: desde 400 mil al mes (un apartaestudio pequeño en una ciudad
    // intermedia) hasta 60 millones (una bodega grande).
    for (const property of rent.value.items) {
      expect(property.price.amount).toBeGreaterThanOrEqual(400_000_00);
      expect(property.price.amount).toBeLessThan(60_000_000_00);
    }
  });

  it("algunos inmuebles no están disponibles: el agente debe saber decirlo", async () => {
    const service = create();
    const result = await service.search({ operation: CatalogOperation.SALE }, { limit: 30 });
    if (!isOk(result)) throw new Error("debería buscar");

    const availability = await Promise.all(
      result.value.items.map((p) => service.checkAvailability(p.ref)),
    );
    const unavailable = availability.filter((a) => isOk(a) && !a.value.available);

    expect(unavailable.length).toBeGreaterThan(0);
  });
});
