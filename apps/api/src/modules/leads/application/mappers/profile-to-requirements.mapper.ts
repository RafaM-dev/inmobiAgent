import type { ProfileSlots } from "../../../conversation";
import {
  LeadFinancing,
  LeadOperation,
  LeadPropertyType,
  LeadTimeline,
  type LeadBudget,
  type LeadRequirements,
} from "../../domain/value-objects/lead-requirements";

/**
 * Traduce la memoria de la conversación a los requisitos de la ficha comercial.
 *
 * Mismo patrón que `preferences-to-criteria` en `agent`, y por el mismo motivo
 * (decisión D11): son vocabularios distintos que hoy coinciden. Las tablas de
 * conversión son explícitas para que, si alguno de los dos lados añade un valor,
 * el compilador obligue a decidir qué hacer con él en vez de dejarlo pasar.
 *
 * Nota sobre la procedencia: aquí se pierde a propósito. En la memoria, "3
 * habitaciones" puede ser algo que el sistema dedujo con confianza 0,6; en la
 * ficha comercial es un requisito. Un asesor no negocia con niveles de confianza
 * y la ficha no debe insinuar una precisión que no tiene.
 */

const OPERATIONS: Record<string, LeadOperation> = {
  SALE: LeadOperation.SALE,
  RENT: LeadOperation.RENT,
};

const TYPES: Record<string, LeadPropertyType> = {
  APARTMENT: LeadPropertyType.APARTMENT,
  HOUSE: LeadPropertyType.HOUSE,
  STUDIO: LeadPropertyType.STUDIO,
  OFFICE: LeadPropertyType.OFFICE,
  COMMERCIAL: LeadPropertyType.COMMERCIAL,
  LOT: LeadPropertyType.LOT,
  WAREHOUSE: LeadPropertyType.WAREHOUSE,
  FARM: LeadPropertyType.FARM,
};

const TIMELINES: Record<string, LeadTimeline> = {
  now: LeadTimeline.NOW,
  "1-3m": LeadTimeline.ONE_TO_THREE_MONTHS,
  "3-6m": LeadTimeline.THREE_TO_SIX_MONTHS,
  exploring: LeadTimeline.EXPLORING,
};

const FINANCINGS: Record<string, LeadFinancing> = {
  cash: LeadFinancing.CASH,
  mortgage: LeadFinancing.MORTGAGE,
  unknown: LeadFinancing.UNKNOWN,
};

const valueOf = (slots: Readonly<ProfileSlots>, name: keyof ProfileSlots): unknown =>
  (slots[name] as { value: unknown } | undefined)?.value;

/** Los slots que son enumerados llegan como cadena o no llegan. */
const codeOf = (slots: Readonly<ProfileSlots>, name: keyof ProfileSlots): string => {
  const value = valueOf(slots, name);
  return typeof value === "string" ? value : "";
};

export const toLeadRequirements = (slots: Readonly<ProfileSlots>): LeadRequirements => {
  const operation = OPERATIONS[codeOf(slots, "operation")];
  const rawTypes = (valueOf(slots, "propertyType") ?? []) as string[];
  const propertyTypes = rawTypes
    .map((type) => TYPES[type])
    .filter((type): type is LeadPropertyType => type !== undefined);

  const city = valueOf(slots, "city") as string | undefined;
  const neighborhoods = valueOf(slots, "neighborhoods") as string[] | undefined;
  const budget = valueOf(slots, "budget") as LeadBudget | undefined;
  const bedrooms = valueOf(slots, "bedrooms") as number | undefined;
  const timeline = TIMELINES[codeOf(slots, "timeline")];
  const financing = FINANCINGS[codeOf(slots, "financing")];

  return {
    ...(operation ? { operation } : {}),
    ...(propertyTypes.length > 0 ? { propertyTypes } : {}),
    ...(city ? { city } : {}),
    ...(neighborhoods && neighborhoods.length > 0 ? { neighborhoods } : {}),
    ...(budget ? { budget } : {}),
    ...(bedrooms !== undefined ? { bedroomsMin: bedrooms } : {}),
    ...(timeline ? { timeline } : {}),
    ...(financing ? { financing } : {}),
  };
};

/** El nombre no es un requisito, pero sí una señal de scoring. */
export const hasName = (slots: Readonly<ProfileSlots>): boolean => {
  const name = valueOf(slots, "name");
  return typeof name === "string" && name.trim().length > 0;
};
