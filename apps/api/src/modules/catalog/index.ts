import { asFunction, type AwilixContainer } from "awilix";
import type { ModuleRegistration } from "../../platform/di/app-module";
import type { PlatformCradle } from "../../platform/di/platform-cradle";
import type { CatalogService } from "./application/ports/catalog-service";
import type { PropertyService } from "./application/ports/property-service";
import { CatalogServiceFacade } from "./application/services/catalog-service.facade";
import {
  CheckPropertyAvailabilityUseCase,
  GetPropertyDetailsUseCase,
  GetPropertyMediaUseCase,
} from "./application/use-cases/get-property-details.use-case";
import { RecordPropertyShownUseCase } from "./application/use-cases/record-property-shown.use-case";
import { SearchPropertiesUseCase } from "./application/use-cases/search-properties.use-case";
import type { PropertySnapshotRepository } from "./domain/repositories/property-snapshot.repository";
import { PrismaPropertySnapshotRepository } from "./infrastructure/persistence/prisma/prisma-property-snapshot.repository";
import { MockPropertyService } from "./infrastructure/providers/mock/mock-property.service";

/* ========================================================================== *
 * CONTRATO PÚBLICO DEL MÓDULO `catalog`
 *
 * Este módulo NO modela inmuebles. Modela referencias a inmuebles ajenos y
 * copias inmutables de lo que se le mostró a un cliente. El catálogo es de la
 * inmobiliaria y de su proveedor; nosotros solo sabemos preguntarle seis cosas.
 * ========================================================================== */

export type {
  PropertyService,
  Property,
  PropertySearchResult,
  PropertyFeatures,
  PropertyAvailability,
  PropertyMedia,
  PropertyImage,
  PropertyLink,
} from "./application/ports/property-service";
export { PropertyRef } from "./domain/value-objects/property-ref";
export { PropertySnapshot } from "./domain/value-objects/property-snapshot";
export {
  CatalogOperation,
  CatalogPropertyType,
  type SearchCriteria,
  type CatalogPage,
  type Money,
  type PriceRange,
} from "./domain/value-objects/search-criteria";
export {
  formatPrice,
  snapshotToCard,
  toPropertyCard,
} from "./application/mappers/property-card.mapper";
export type { CatalogService } from "./application/ports/catalog-service";
export type { PropertyDetails } from "./application/use-cases/get-property-details.use-case";
export type {
  RecordPropertyShownCommand,
} from "./application/use-cases/record-property-shown.use-case";
export type {
  SearchPropertiesCommand,
} from "./application/use-cases/search-properties.use-case";
export type { SearchPropertiesResult } from "./application/use-cases/search-properties.use-case";
export {
  PropertySearchPerformed,
  PropertyShown,
  type PropertySearchPerformedPayload,
  type PropertyShownPayload,
} from "./application/events/catalog.events";

export interface CatalogCradle {
  propertyService: PropertyService;
  propertySnapshotRepository: PropertySnapshotRepository;
  searchProperties: SearchPropertiesUseCase;
  getPropertyDetails: GetPropertyDetailsUseCase;
  checkPropertyAvailability: CheckPropertyAvailabilityUseCase;
  getPropertyMedia: GetPropertyMediaUseCase;
  recordPropertyShown: RecordPropertyShownUseCase;
  /** Puerto público: es lo que consume el agente. */
  catalogService: CatalogService;
}

type Cradle = PlatformCradle & CatalogCradle;

export const catalogModule: ModuleRegistration<Cradle> = {
  name: "catalog",

  registerDependencies(container: AwilixContainer<Cradle>): void {
    container.register({
      /**
       * ÚNICO punto del sistema donde se elige el proveedor de inmuebles.
       *
       * No hay adaptador `http` todavía, y es una decisión, no un olvido: no
       * conocemos la API de ningún proveedor real, y escribir uno "genérico"
       * hoy significaría inventarse endpoints, autenticación y formatos de
       * respuesta. El día que haya un proveedor concreto sobre la mesa, se
       * escribe su adaptador contra el puerto y se añade un `case` aquí. Nada
       * más del sistema cambia.
       */
      propertyService: asFunction((c: Cradle): PropertyService => {
        switch (c.config.providers.property) {
          case "mock":
            return new MockPropertyService();
          default:
            throw new Error(
              `No hay adaptador para PROPERTY_PROVIDER="${c.config.providers.property}". ` +
                "Se escribirá cuando exista un proveedor real; usa PROPERTY_PROVIDER=mock.",
            );
        }
      }).singleton(),

      propertySnapshotRepository: asFunction(
        (c: Cradle): PropertySnapshotRepository =>
          new PrismaPropertySnapshotRepository(c.database, c.ids),
      ).singleton(),

      searchProperties: asFunction(
        (c: Cradle) =>
          new SearchPropertiesUseCase({
            properties: c.propertyService,
            events: c.eventPublisher,
            clock: c.clock,
            logger: c.logger.child({ module: "catalog" }),
          }),
      ).singleton(),

      getPropertyDetails: asFunction(
        (c: Cradle) => new GetPropertyDetailsUseCase({ properties: c.propertyService }),
      ).singleton(),

      checkPropertyAvailability: asFunction(
        (c: Cradle) => new CheckPropertyAvailabilityUseCase({ properties: c.propertyService }),
      ).singleton(),

      getPropertyMedia: asFunction(
        (c: Cradle) => new GetPropertyMediaUseCase({ properties: c.propertyService }),
      ).singleton(),

      recordPropertyShown: asFunction(
        (c: Cradle) =>
          new RecordPropertyShownUseCase({
            snapshots: c.propertySnapshotRepository,
            unitOfWork: c.unitOfWork,
            events: c.eventPublisher,
            clock: c.clock,
          }),
      ).singleton(),

      catalogService: asFunction(
        (c: Cradle): CatalogService =>
          new CatalogServiceFacade({
            search: c.searchProperties,
            details: c.getPropertyDetails,
            availability: c.checkPropertyAvailability,
            media: c.getPropertyMedia,
            recordShown: c.recordPropertyShown,
          }),
      ).singleton(),
    });
  },
};
