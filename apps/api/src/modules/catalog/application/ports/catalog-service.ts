import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { PropertyRef } from "../../domain/value-objects/property-ref";
import type { PropertyAvailability, PropertyMedia } from "./property-service";
import type { PropertyDetails } from "../use-cases/get-property-details.use-case";
import type {
  RecordPropertyShownCommand,
  RecordPropertyShownResult,
} from "../use-cases/record-property-shown.use-case";
import type {
  SearchPropertiesCommand,
  SearchPropertiesResult,
} from "../use-cases/search-properties.use-case";

/**
 * Puerto público de `catalog` hacia el resto del sistema.
 *
 * Ojo a la diferencia con `PropertyService`: aquél es el puerto *hacia fuera*,
 * el que implementa cada proveedor de inmuebles. Éste es el puerto *hacia
 * dentro*, el que usa el agente. Separarlos permite que este lado añada cosas
 * que ningún proveedor conoce —dejar constancia de lo mostrado, publicar
 * eventos— sin ensuciar el contrato que tendrá que cumplir un tercero.
 */
export interface CatalogService {
  search(command: SearchPropertiesCommand): Promise<Result<SearchPropertiesResult, AppError>>;
  details(ref: PropertyRef): Promise<Result<PropertyDetails, AppError>>;
  availability(ref: PropertyRef): Promise<Result<PropertyAvailability, AppError>>;
  media(ref: PropertyRef): Promise<Result<PropertyMedia, AppError>>;
  recordShown(
    command: RecordPropertyShownCommand,
  ): Promise<Result<RecordPropertyShownResult, AppError>>;
}
