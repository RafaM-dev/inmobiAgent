import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../platform/result/result";
import type { PropertyService } from "../application/ports/property-service";
import { PropertyRef } from "../domain/value-objects/property-ref";
import { CatalogOperation, type SearchCriteria } from "../domain/value-objects/search-criteria";

/**
 * SUITE DE CONTRATO del puerto `PropertyService`.
 *
 * La misma suite corre hoy contra el mock y correrá mañana contra el adaptador
 * de cualquier proveedor real, sea cual sea. Comprueba lo que el resto del
 * sistema da por supuesto y nada más:
 *
 *  · los filtros se respetan (si pido arriendo, no llega una venta);
 *  · una referencia desconocida devuelve un error, no una excepción ni datos
 *    inventados — el agente NUNCA puede recibir un precio de la nada;
 *  · la paginación avanza y termina;
 *  · las referencias que salen de `search` sirven para `getById`.
 *
 * Lo que NO comprueba: cuántos inmuebles hay, cuáles, ni en qué orden. Eso es
 * asunto de cada proveedor.
 */
export const describePropertyServiceContract = (
  name: string,
  create: () => PropertyService,
): void => {
  const rentInMedellin: SearchCriteria = {
    operation: CatalogOperation.RENT,
    city: "Medellín",
  };

  describe(`Contrato PropertyService — ${name}`, () => {
    it("declara de qué proveedor viene", () => {
      expect(create().source.length).toBeGreaterThan(0);
    });

    it("respeta la operación pedida", async () => {
      const result = await create().search({ operation: CatalogOperation.RENT }, { limit: 10 });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      for (const property of result.value.items) {
        expect(property.operation).toBe(CatalogOperation.RENT);
      }
    });

    it("respeta el techo de precio", async () => {
      const max = 3_000_000_00; // 3 millones de pesos, en centavos
      const result = await create().search(
        { operation: CatalogOperation.RENT, price: { max, currency: "COP" } },
        { limit: 20 },
      );

      if (!isOk(result)) return;
      expect(result.value.items.length).toBeGreaterThan(0);
      for (const property of result.value.items) {
        expect(property.price.amount).toBeLessThanOrEqual(max);
      }
    });

    it("respeta el mínimo de habitaciones", async () => {
      const result = await create().search(
        { operation: CatalogOperation.SALE, bedroomsMin: 3 },
        { limit: 20 },
      );

      if (!isOk(result)) return;
      for (const property of result.value.items) {
        expect(property.bedrooms ?? 0).toBeGreaterThanOrEqual(3);
      }
    });

    it("nunca devuelve más elementos de los pedidos", async () => {
      const result = await create().search(rentInMedellin, { limit: 3 });

      if (!isOk(result)) return;
      expect(result.value.items.length).toBeLessThanOrEqual(3);
    });

    it("la paginación avanza sin repetir y termina", async () => {
      const service = create();
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;

      do {
        const result = await service.search(
          { operation: CatalogOperation.SALE },
          { limit: 10, ...(cursor ? { cursor } : {}) },
        );
        if (!isOk(result)) break;

        for (const property of result.value.items) {
          expect(seen.has(property.ref.key)).toBe(false);
          seen.add(property.ref.key);
        }
        cursor = result.value.nextCursor;
        pages += 1;
      } while (cursor && pages < 25);

      expect(pages).toBeGreaterThan(1);
      expect(cursor).toBeUndefined();
    });

    it("una búsqueda imposible devuelve vacío, no un error", async () => {
      const result = await create().search(
        { operation: CatalogOperation.SALE, city: "Ciudad Que No Existe" },
        { limit: 10 },
      );

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.items).toHaveLength(0);
    });

    it("las referencias de la búsqueda sirven para pedir el detalle", async () => {
      const service = create();
      const search = await service.search(rentInMedellin, { limit: 1 });
      if (!isOk(search)) return;

      const first = search.value.items[0];
      expect(first).toBeDefined();
      if (!first) return;

      const detail = await service.getById(first.ref);
      expect(isOk(detail)).toBe(true);
      if (!isOk(detail)) return;
      expect(detail.value.ref.key).toBe(first.ref.key);
    });

    it("responde a las seis capacidades para una referencia válida", async () => {
      const service = create();
      const search = await service.search(rentInMedellin, { limit: 1 });
      if (!isOk(search)) return;
      const ref = search.value.items[0]?.ref;
      if (!ref) return;

      expect(isOk(await service.getById(ref))).toBe(true);
      expect(isOk(await service.getFeatures(ref))).toBe(true);
      expect(isOk(await service.checkAvailability(ref))).toBe(true);
      expect(isOk(await service.getMedia(ref))).toBe(true);
      expect(isOk(await service.getLink(ref))).toBe(true);
    });

    it("una referencia desconocida da error en TODAS las operaciones", async () => {
      const service = create();
      const ghost = PropertyRef.create(service.source, "NO-EXISTE-0000");

      // Es el test más importante de la suite: si un proveedor inventara datos
      // para una referencia que no conoce, el agente se los diría a un cliente.
      expect(isErr(await service.getById(ghost))).toBe(true);
      expect(isErr(await service.getFeatures(ghost))).toBe(true);
      expect(isErr(await service.checkAvailability(ghost))).toBe(true);
      expect(isErr(await service.getMedia(ghost))).toBe(true);
      expect(isErr(await service.getLink(ghost))).toBe(true);
    });

    it("no lanza excepciones: los fallos viajan como Result", async () => {
      const service = create();
      const ghost = PropertyRef.create(service.source, "NO-EXISTE-0000");

      const outcome = await service.getById(ghost).catch(() => "lanzó");
      expect(outcome).not.toBe("lanzó");
    });

    it("los importes son enteros en unidades mínimas, con su moneda", async () => {
      const result = await create().search({ operation: CatalogOperation.SALE }, { limit: 5 });

      if (!isOk(result)) return;
      for (const property of result.value.items) {
        expect(Number.isInteger(property.price.amount)).toBe(true);
        expect(property.price.currency).toMatch(/^[A-Z]{3}$/);
      }
    });
  });
};
