import { z } from "zod";
import { isErr } from "../../../../platform/result/result";
import type { ReplyBlock } from "../../../channels";
import { PropertyRef, toPropertyCard, type CatalogService } from "../../../catalog";
import {
  toolError,
  toolOk,
  type AgentTool,
  type ToolResult,
} from "../ports/agent-tool";

const refSchema = z.object({
  ref: z
    .string()
    .min(3)
    .max(120)
    .describe('Referencia del inmueble tal como aparece en los resultados, ej. "mock:APA-0042"'),
});

type RefArgs = z.infer<typeof refSchema>;

/** Traduce el string del modelo a una referencia válida, sin lanzar. */
const parseRef = (raw: string): PropertyRef | null => {
  try {
    return PropertyRef.parse(raw);
  } catch {
    return null;
  }
};

const INVALID_REF =
  "Esa referencia no tiene un formato válido. Usa exactamente la que aparece en los resultados.";

/**
 * `get_property_details` — cuando el cliente pregunta por uno en concreto.
 *
 * Devuelve la ficha renderizada desde los datos del proveedor, igual que la
 * búsqueda: el modelo no escribe ni el precio ni el área.
 */
export const createPropertyDetailsTool = (deps: {
  catalog: CatalogService;
}): AgentTool<RefArgs, Record<string, unknown>> => ({
  name: "get_property_details",
  description:
    "Consulta los detalles completos de UN inmueble concreto por su referencia. Úsala cuando " +
    "el cliente pregunte por uno de los que le mostraste.",
  parameters: refSchema,
  sideEffect: "none",

  async execute(args: RefArgs): Promise<ToolResult<Record<string, unknown>>> {
    const ref = parseRef(args.ref);
    if (!ref) return toolError("INVALID_REF", INVALID_REF, true);

    const details = await deps.catalog.details(ref);
    if (isErr(details)) {
      return toolError(
        "PROPERTY_NOT_FOUND",
        "No encontré ese inmueble. No inventes sus datos: dile que lo verificas.",
        false,
      );
    }

    const { property, attributes, url } = details.value;
    const card = toPropertyCard(property, url ? { url } : {});
    const blocks: ReplyBlock[] = [{ kind: "property_card", card }];

    return toolOk(
      {
        ref: property.ref.key,
        title: property.title,
        price: property.price.amount,
        currency: property.price.currency,
        city: property.city,
        neighborhood: property.neighborhood,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        areaM2: property.areaM2,
        attributes: attributes.map((attribute) => `${attribute.label}: ${attribute.value}`),
        url,
      },
      `Detalle de ${property.title}`,
      blocks,
    );
  },
});

/**
 * `check_property_availability` — antes de agendar nada.
 *
 * Se consulta en el momento y no se guarda: la disponibilidad de hace una hora
 * no sirve para prometerle una visita a nadie.
 */
export const createCheckAvailabilityTool = (deps: {
  catalog: CatalogService;
}): AgentTool<RefArgs, { available: boolean; status?: string }> => ({
  name: "check_property_availability",
  description:
    "Comprueba si un inmueble sigue disponible. Úsala SIEMPRE antes de proponer una visita o " +
    "de decirle al cliente que puede verlo.",
  parameters: refSchema,
  sideEffect: "none",

  async execute(args: RefArgs): Promise<ToolResult<{ available: boolean; status?: string }>> {
    const ref = parseRef(args.ref);
    if (!ref) return toolError("INVALID_REF", INVALID_REF, true);

    const availability = await deps.catalog.availability(ref);
    if (isErr(availability)) {
      return toolError(
        "AVAILABILITY_UNKNOWN",
        "No pude confirmar la disponibilidad. Dilo con naturalidad; no la des por hecha.",
        true,
      );
    }

    return toolOk(
      {
        available: availability.value.available,
        ...(availability.value.status ? { status: availability.value.status } : {}),
      },
      availability.value.available ? "Disponible" : "No disponible",
    );
  },
});

/**
 * `get_property_media` — fotos.
 *
 * Devuelve bloques de media; si el canal no las soporta, el renderer los
 * degrada a enlaces sin que la herramienta ni el agente se enteren.
 */
export const createPropertyMediaTool = (deps: {
  catalog: CatalogService;
}): AgentTool<RefArgs, { images: readonly string[] }> => ({
  name: "get_property_media",
  description:
    "Obtiene las fotos de un inmueble. Úsala si el cliente pide ver imágenes de uno concreto.",
  parameters: refSchema,
  sideEffect: "none",

  async execute(args: RefArgs): Promise<ToolResult<{ images: readonly string[] }>> {
    const ref = parseRef(args.ref);
    if (!ref) return toolError("INVALID_REF", INVALID_REF, true);

    const media = await deps.catalog.media(ref);
    if (isErr(media) || media.value.images.length === 0) {
      return toolError(
        "MEDIA_UNAVAILABLE",
        "Ese inmueble no tiene fotos disponibles ahora mismo.",
        false,
      );
    }

    // Tres como máximo: un chat con ocho fotos seguidas es spam.
    const images = media.value.images.slice(0, 3);
    const blocks: ReplyBlock[] = images.map((image) => ({
      kind: "media",
      url: image.url,
      mediaType: "image",
      ...(image.caption ? { caption: image.caption } : {}),
    }));

    return toolOk(
      { images: images.map((image) => image.url) },
      `${String(images.length)} fotos`,
      blocks,
    );
  },
});
