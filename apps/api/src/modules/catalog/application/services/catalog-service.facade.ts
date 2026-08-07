import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { PropertyRef } from "../../domain/value-objects/property-ref";
import type { CatalogService } from "../ports/catalog-service";
import type { PropertyAvailability, PropertyMedia } from "../ports/property-service";
import type {
  CheckPropertyAvailabilityUseCase,
  GetPropertyDetailsUseCase,
  GetPropertyMediaUseCase,
  PropertyDetails,
} from "../use-cases/get-property-details.use-case";
import type {
  RecordPropertyShownCommand,
  RecordPropertyShownResult,
  RecordPropertyShownUseCase,
} from "../use-cases/record-property-shown.use-case";
import type {
  SearchPropertiesCommand,
  SearchPropertiesResult,
  SearchPropertiesUseCase,
} from "../use-cases/search-properties.use-case";

/** Traduce el puerto público a casos de uso concretos. */
export class CatalogServiceFacade implements CatalogService {
  constructor(
    private readonly deps: {
      search: SearchPropertiesUseCase;
      details: GetPropertyDetailsUseCase;
      availability: CheckPropertyAvailabilityUseCase;
      media: GetPropertyMediaUseCase;
      recordShown: RecordPropertyShownUseCase;
    },
  ) {}

  search(command: SearchPropertiesCommand): Promise<Result<SearchPropertiesResult, AppError>> {
    return this.deps.search.execute(command);
  }

  details(ref: PropertyRef): Promise<Result<PropertyDetails, AppError>> {
    return this.deps.details.execute(ref);
  }

  availability(ref: PropertyRef): Promise<Result<PropertyAvailability, AppError>> {
    return this.deps.availability.execute(ref);
  }

  media(ref: PropertyRef): Promise<Result<PropertyMedia, AppError>> {
    return this.deps.media.execute(ref);
  }

  recordShown(
    command: RecordPropertyShownCommand,
  ): Promise<Result<RecordPropertyShownResult, AppError>> {
    return this.deps.recordShown.execute(command);
  }
}
