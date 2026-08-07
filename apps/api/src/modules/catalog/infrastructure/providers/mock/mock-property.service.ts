import { NotFoundError, type AppError } from "../../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../../platform/result/result";
import type {
  Property,
  PropertyAvailability,
  PropertyFeatures,
  PropertyLink,
  PropertyMedia,
  PropertySearchResult,
  PropertyService,
} from "../../../application/ports/property-service";
import type { PropertyRef } from "../../../domain/value-objects/property-ref";
import type { CatalogPage, SearchCriteria } from "../../../domain/value-objects/search-criteria";
import { buildSeedCatalog } from "./seed-dataset";

/**
 * `MockPropertyService` — el catálogo del modo demo.
 *
 * Filtra de verdad: rangos de precio, ciudad, barrios, tipo, habitaciones,
 * baños, área y características. No devuelve "los tres primeros" ni ignora los
 * criterios. Esa diferencia importa porque es lo que hace que el flujo
 * conversacional completo —descubrir, buscar, presentar, refinar— se pueda
 * probar y demostrar sin pagar a nadie y sin depender de un proveedor real.
 *
 * Determinista de principio a fin: el mismo criterio devuelve siempre los
 * mismos inmuebles en el mismo orden.
 */
export class MockPropertyService implements PropertyService {
  readonly source = "mock";

  private readonly catalog: readonly Property[];
  private readonly byKey: ReadonlyMap<string, Property>;

  constructor(options: { size?: number } = {}) {
    this.catalog = buildSeedCatalog(this.source, options.size ?? 120);
    this.byKey = new Map(this.catalog.map((property) => [property.ref.key, property]));
  }

  search(
    criteria: SearchCriteria,
    page: CatalogPage,
  ): Promise<Result<PropertySearchResult, AppError>> {
    const matches = this.catalog.filter((property) => this.matches(property, criteria));

    // Orden estable y útil: primero lo más barato dentro de lo que se pidió.
    const sorted = [...matches].sort(
      (a, b) => a.price.amount - b.price.amount || a.ref.externalId.localeCompare(b.ref.externalId),
    );

    const offset = decodeCursor(page.cursor);
    const limit = Math.min(Math.max(page.limit, 1), 50);
    const items = sorted.slice(offset, offset + limit);
    const nextOffset = offset + items.length;

    return Promise.resolve(
      ok({
        items,
        ...(nextOffset < sorted.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
        totalEstimate: sorted.length,
      }),
    );
  }

  getById(ref: PropertyRef): Promise<Result<Property, AppError>> {
    const property = this.byKey.get(ref.key);
    return Promise.resolve(
      property ? ok(property) : errNotFound(ref),
    );
  }

  getFeatures(ref: PropertyRef): Promise<Result<PropertyFeatures, AppError>> {
    const property = this.byKey.get(ref.key);
    if (!property) return Promise.resolve(errNotFound(ref));

    const attributes: { label: string; value: string }[] = [
      { label: "Tipo", value: property.type },
      { label: "Operación", value: property.operation },
      { label: "Ciudad", value: property.city },
    ];
    if (property.neighborhood) attributes.push({ label: "Barrio", value: property.neighborhood });
    if (property.areaM2 !== undefined) {
      attributes.push({ label: "Área", value: `${String(property.areaM2)} m²` });
    }
    if (property.bedrooms !== undefined) {
      attributes.push({ label: "Habitaciones", value: String(property.bedrooms) });
    }
    if (property.bathrooms !== undefined) {
      attributes.push({ label: "Baños", value: String(property.bathrooms) });
    }
    for (const feature of property.features) {
      attributes.push({ label: "Incluye", value: feature });
    }

    return Promise.resolve(ok({ ref, attributes }));
  }

  checkAvailability(ref: PropertyRef): Promise<Result<PropertyAvailability, AppError>> {
    const property = this.byKey.get(ref.key);
    if (!property) return Promise.resolve(errNotFound(ref));

    // Uno de cada siete aparece como no disponible: el agente tiene que saber
    // decir "ese ya no está" sin que eso sea un caso raro que nadie probó.
    const unavailable = hashOf(ref.key) % 7 === 0;

    return Promise.resolve(
      ok({
        ref,
        available: !unavailable,
        status: unavailable ? "Reservado" : "Disponible",
        ...(unavailable ? {} : { availableFrom: "inmediata" }),
      }),
    );
  }

  getMedia(ref: PropertyRef): Promise<Result<PropertyMedia, AppError>> {
    const property = this.byKey.get(ref.key);
    if (!property) return Promise.resolve(errNotFound(ref));

    const count = 2 + (hashOf(ref.key) % 4);
    const images = Array.from({ length: count }, (_, index) => ({
      // URLs simuladas: no se descarga nada, solo se comprueba el flujo.
      url: `https://demo.agentinmobi.local/media/${ref.externalId}/${String(index + 1)}.jpg`,
      caption: index === 0 ? "Fachada" : `Foto ${String(index + 1)}`,
    }));

    return Promise.resolve(ok({ ref, images }));
  }

  getLink(ref: PropertyRef): Promise<Result<PropertyLink, AppError>> {
    const property = this.byKey.get(ref.key);
    if (!property) return Promise.resolve(errNotFound(ref));

    return Promise.resolve(
      ok({ ref, url: `https://demo.agentinmobi.local/inmueble/${ref.externalId}` }),
    );
  }

  /* ---------------------------------------------------------------------- */

  private matches(property: Property, criteria: SearchCriteria): boolean {
    if (property.operation !== criteria.operation) return false;

    if (criteria.propertyTypes?.length && !criteria.propertyTypes.includes(property.type)) {
      return false;
    }

    if (criteria.city && normalize(property.city) !== normalize(criteria.city)) return false;

    if (criteria.neighborhoods?.length) {
      const wanted = criteria.neighborhoods.map(normalize);
      const actual = normalize(property.neighborhood ?? "");
      if (!wanted.some((zone) => actual.includes(zone) || zone.includes(actual))) return false;
    }

    if (criteria.price) {
      if (criteria.price.currency !== property.price.currency) return false;
      if (criteria.price.min !== undefined && property.price.amount < criteria.price.min) {
        return false;
      }
      if (criteria.price.max !== undefined && property.price.amount > criteria.price.max) {
        return false;
      }
    }

    if (criteria.bedroomsMin !== undefined && (property.bedrooms ?? 0) < criteria.bedroomsMin) {
      return false;
    }
    if (criteria.bathroomsMin !== undefined && (property.bathrooms ?? 0) < criteria.bathroomsMin) {
      return false;
    }

    if (criteria.area?.min !== undefined && (property.areaM2 ?? 0) < criteria.area.min) {
      return false;
    }
    if (criteria.area?.max !== undefined && (property.areaM2 ?? Infinity) > criteria.area.max) {
      return false;
    }

    if (criteria.features?.length) {
      const available = property.features.map(normalize);
      const required = criteria.features.map(normalize);
      if (!required.every((feature) => available.some((have) => have.includes(feature)))) {
        return false;
      }
    }

    return true;
  }
}

/* -------------------------------------------------------------------------- */

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

/** Cursor opaco: quien lo recibe no debe poder deducir que es un desplazamiento. */
const encodeCursor = (offset: number): string =>
  Buffer.from(`offset:${String(offset)}`).toString("base64url");

const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const value = Number(decoded.replace("offset:", ""));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
};

const hashOf = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1_000_003;
  }
  return hash;
};

const errNotFound = (ref: PropertyRef): Result<never, AppError> => ({
  ok: false,
  error: new NotFoundError("Inmueble", ref.key),
});
