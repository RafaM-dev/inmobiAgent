import type { TimeSlot } from "../../domain/value-objects/time-slot";

/**
 * Cómo se escribe una franja para un cliente.
 *
 * Vive aquí y no en el prompt por la misma razón que los precios de las fichas:
 * **el modelo no escribe fechas**. Si el texto de la hora lo redactara el LLM,
 * un error suyo mandaría a un cliente a una oficina cerrada un jueves que no
 * era. Esta función recibe un instante y lo escribe; no hay margen.
 *
 * Siempre en la zona horaria del tenant: la cita es a las diez de la mañana de
 * la inmobiliaria, no de UTC ni del servidor.
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timezone: string, locale: string): Intl.DateTimeFormat => {
  const key = `${locale}|${timezone}`;
  const cached = FORMATTERS.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  FORMATTERS.set(key, formatter);
  return formatter;
};

/** Ej.: «jueves, 7 de agosto, 10:00 a. m.» */
export const formatSlot = (slot: TimeSlot, timezone: string, locale = "es-CO"): string =>
  formatterFor(timezone, locale).format(slot.startsAt);
