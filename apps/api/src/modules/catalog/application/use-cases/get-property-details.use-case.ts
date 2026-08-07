import type { AppError } from "../../../../platform/errors/app-error";
import { isErr, isOk, ok, type Result } from "../../../../platform/result/result";
import type { PropertyRef } from "../../domain/value-objects/property-ref";
import type {
  Property,
  PropertyAvailability,
  PropertyMedia,
  PropertyService,
} from "../ports/property-service";

export interface PropertyDetails {
  readonly property: Property;
  readonly attributes: readonly { readonly label: string; readonly value: string }[];
  readonly url?: string;
}

/**
 * Detalle de un inmueble.
 *
 * Compone tres de las seis capacidades del puerto —ficha, características y
 * enlace— en una sola respuesta, porque para el agente son una sola pregunta:
 * "cuéntame de ese". El puerto sigue teniendo exactamente seis métodos; quien
 * los junta es esta capa, no el proveedor.
 *
 * Las características y el enlace son opcionales a propósito: si un proveedor
 * no los tiene, se devuelve lo que sí hay en vez de fallar entero. Un cliente
 * prefiere una ficha sin enlace a un "no pude consultarlo".
 */
export class GetPropertyDetailsUseCase {
  constructor(private readonly deps: { properties: PropertyService }) {}

  async execute(ref: PropertyRef): Promise<Result<PropertyDetails, AppError>> {
    const property = await this.deps.properties.getById(ref);
    if (isErr(property)) return property;

    const [features, link] = await Promise.all([
      this.deps.properties.getFeatures(ref),
      this.deps.properties.getLink(ref),
    ]);

    return ok({
      property: property.value,
      attributes: isOk(features) ? features.value.attributes : [],
      ...(isOk(link) ? { url: link.value.url } : {}),
    });
  }
}

/**
 * Disponibilidad. Va aparte del detalle porque cambia con el tiempo y el
 * agente la consulta justo antes de agendar una visita, no antes.
 */
export class CheckPropertyAvailabilityUseCase {
  constructor(private readonly deps: { properties: PropertyService }) {}

  execute(ref: PropertyRef): Promise<Result<PropertyAvailability, AppError>> {
    return this.deps.properties.checkAvailability(ref);
  }
}

/** Imágenes. Se piden solo cuando el canal puede mostrarlas. */
export class GetPropertyMediaUseCase {
  constructor(private readonly deps: { properties: PropertyService }) {}

  execute(ref: PropertyRef): Promise<Result<PropertyMedia, AppError>> {
    return this.deps.properties.getMedia(ref);
  }
}
