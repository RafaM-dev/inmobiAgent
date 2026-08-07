import { defineEvent } from "../../../../platform/events/event";

/**
 * Eventos de integración de `catalog`.
 *
 * `PropertyShown` es el que despertará a `leads` en F4: si un cliente vio tres
 * inmuebles, hay interés que registrar. Publicarlo hoy, sin consumidores, es lo
 * que hará que F4 no tenga que tocar este módulo.
 */

export interface PropertySearchPerformedPayload {
  readonly conversationId: string;
  readonly source: string;
  /** Criterios usados, para analizar qué se busca y no se encuentra. */
  readonly criteria: Record<string, unknown>;
  readonly resultCount: number;
  readonly durationMs: number;
}

export const PropertySearchPerformed = defineEvent<PropertySearchPerformedPayload>(
  "catalog.property_search_performed",
);

export interface PropertyShownPayload {
  readonly conversationId: string;
  readonly contactId: string;
  /** Referencias mostradas, en formato `"source:externalId"`. */
  readonly refs: readonly string[];
  readonly snapshotIds: readonly string[];
}

export const PropertyShown = defineEvent<PropertyShownPayload>("catalog.property_shown");
