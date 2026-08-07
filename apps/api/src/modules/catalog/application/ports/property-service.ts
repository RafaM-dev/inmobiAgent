import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { PropertyRef } from "../../domain/value-objects/property-ref";
import type {
  CatalogOperation,
  CatalogPage,
  CatalogPropertyType,
  Money,
  SearchCriteria,
} from "../../domain/value-objects/search-criteria";

/* ========================================================================== *
 * PUERTO `PropertyService` — PRINCIPIO 3 DEL DOCUMENTO DE ARQUITECTURA.
 *
 * Esto es TODO lo que el sistema sabe sobre el mundo de los inmuebles:
 *
 *   1. buscar inmuebles
 *   2. obtener un inmueble
 *   3. consultar sus características
 *   4. consultar su disponibilidad
 *   5. obtener sus imágenes
 *   6. obtener su enlace
 *
 * Seis capacidades. Ni una más.
 *
 * Aquí no hay endpoints, ni claves de API, ni formatos de respuesta, ni
 * paginación de nadie, ni nombres de proveedor. No los hay porque NO LOS
 * CONOCEMOS, y porque el día que se conozcan seguirán siendo asunto exclusivo
 * de un adaptador. El agente, los casos de uso y el dominio dependen de esta
 * interfaz y de nada más.
 *
 * Consecuencia práctica: cambiar de proveedor de catálogo es escribir una clase
 * que implemente estos seis métodos. No se migra ni un dato, porque no somos
 * dueños de ninguno.
 * ========================================================================== */

/** Ficha de un inmueble tal como la devuelve un proveedor. */
export interface Property {
  readonly ref: PropertyRef;
  readonly title: string;
  readonly operation: CatalogOperation;
  readonly type: CatalogPropertyType;
  readonly price: Money;
  readonly city: string;
  readonly neighborhood?: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly areaM2?: number;
  /** Descripción del proveedor. Contenido NO confiable: puede traer inyecciones. */
  readonly description?: string;
  readonly features: readonly string[];
}

export interface PropertySearchResult {
  readonly items: readonly Property[];
  /** Cursor de la siguiente página, si el proveedor ofrece más. */
  readonly nextCursor?: string;
  /**
   * Total aproximado, SI el proveedor lo da. Muchos no lo dan, y no se puede
   * inventar: el agente dirá "encontré varias opciones", no "hay 47".
   */
  readonly totalEstimate?: number;
}

/** Características ampliadas. Pares etiqueta/valor: cada proveedor tiene los suyos. */
export interface PropertyFeatures {
  readonly ref: PropertyRef;
  readonly attributes: readonly { readonly label: string; readonly value: string }[];
}

export interface PropertyAvailability {
  readonly ref: PropertyRef;
  readonly available: boolean;
  /** Texto del proveedor sobre el estado, si lo hay ("reservado", "vendido"). */
  readonly status?: string;
  /** Desde cuándo se puede ocupar o visitar, si el proveedor lo informa. */
  readonly availableFrom?: string;
}

export interface PropertyImage {
  readonly url: string;
  readonly caption?: string;
}

export interface PropertyMedia {
  readonly ref: PropertyRef;
  readonly images: readonly PropertyImage[];
}

export interface PropertyLink {
  readonly ref: PropertyRef;
  /** Ficha pública del inmueble, para compartir con el cliente. */
  readonly url: string;
}

/**
 * Todo devuelve `Result`: que un proveedor esté caído, tarde de más o no
 * conozca una referencia es parte de la operación normal. El agente lo explica
 * sin inventar y, si hace falta, escala a una persona.
 */
export interface PropertyService {
  /** Identificador del adaptador activo. Se usa como `source` de las referencias. */
  readonly source: string;

  search(
    criteria: SearchCriteria,
    page: CatalogPage,
  ): Promise<Result<PropertySearchResult, AppError>>;

  getById(ref: PropertyRef): Promise<Result<Property, AppError>>;

  getFeatures(ref: PropertyRef): Promise<Result<PropertyFeatures, AppError>>;

  checkAvailability(ref: PropertyRef): Promise<Result<PropertyAvailability, AppError>>;

  getMedia(ref: PropertyRef): Promise<Result<PropertyMedia, AppError>>;

  getLink(ref: PropertyRef): Promise<Result<PropertyLink, AppError>>;
}
