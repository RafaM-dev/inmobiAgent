import type { Clock } from "../../../../platform/clock/clock";
import type { AppError } from "../../../../platform/errors/app-error";
import type { EventPublisher } from "../../../../platform/events/event-publisher";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr, ok, type Result } from "../../../../platform/result/result";
import type { CatalogPage, SearchCriteria } from "../../domain/value-objects/search-criteria";
import { PropertySearchPerformed } from "../events/catalog.events";
import type { Property, PropertyService } from "../ports/property-service";

export interface SearchPropertiesCommand {
  readonly criteria: SearchCriteria;
  readonly page: CatalogPage;
  /** Conversación desde la que se busca, para poder analizar el embudo. */
  readonly conversationId: string;
}

export interface SearchPropertiesResult {
  readonly items: readonly Property[];
  readonly nextCursor?: string;
  readonly totalEstimate?: number;
}

/**
 * Buscar inmuebles.
 *
 * Es una envoltura fina sobre el puerto, y así debe seguir: toda la
 * inteligencia de búsqueda vive en el proveedor, que es quien conoce su
 * catálogo. Lo que este caso de uso añade es lo que el proveedor no puede
 * saber: qué conversación buscaba, cuánto tardó y qué se encontró — la materia
 * prima para responder algún día "¿qué nos piden los clientes que no tenemos?".
 *
 * El fallo del proveedor NO se convierte en excepción: vuelve como `Result` y
 * el agente decide si lo explica o escala.
 */
export class SearchPropertiesUseCase {
  constructor(
    private readonly deps: {
      properties: PropertyService;
      events: EventPublisher;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(
    command: SearchPropertiesCommand,
  ): Promise<Result<SearchPropertiesResult, AppError>> {
    const startedAt = this.deps.clock.nowMs();
    const found = await this.deps.properties.search(command.criteria, command.page);
    const durationMs = this.deps.clock.nowMs() - startedAt;

    if (isErr(found)) {
      this.deps.logger.warn("El proveedor de inmuebles falló", {
        source: this.deps.properties.source,
        errorCode: found.error.code,
        durationMs,
      });
      return found;
    }

    await this.deps.events.publish(PropertySearchPerformed, {
      conversationId: command.conversationId,
      source: this.deps.properties.source,
      criteria: { ...command.criteria },
      resultCount: found.value.items.length,
      durationMs,
    });

    return ok({
      items: found.value.items,
      ...(found.value.nextCursor ? { nextCursor: found.value.nextCursor } : {}),
      ...(found.value.totalEstimate !== undefined
        ? { totalEstimate: found.value.totalEstimate }
        : {}),
    });
  }
}
