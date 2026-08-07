/**
 * Lo que el cliente busca, tal y como lo archiva el CRM.
 *
 * Tercer vocabulario del sistema, y es deliberado (decisión D11, ahora D18):
 *  · `conversation` guarda lo que el cliente *dijo*, con procedencia y confianza;
 *  · `catalog` traduce a lo que se le *pide a un proveedor*;
 *  · aquí vive lo que queda *archivado en la ficha comercial*.
 *
 * Parecen lo mismo hoy. No lo son: el perfil cambia mientras el cliente habla,
 * el criterio de búsqueda muere con la consulta, y estos requisitos son la foto
 * que un asesor abrirá dentro de tres semanas. Compartir el tipo obligaría a
 * que un cambio en la memoria conversacional reescribiera fichas cerradas.
 */

export const LeadOperation = {
  SALE: "SALE",
  RENT: "RENT",
} as const;
export type LeadOperation = (typeof LeadOperation)[keyof typeof LeadOperation];

export const LeadPropertyType = {
  APARTMENT: "APARTMENT",
  HOUSE: "HOUSE",
  STUDIO: "STUDIO",
  OFFICE: "OFFICE",
  COMMERCIAL: "COMMERCIAL",
  LOT: "LOT",
  WAREHOUSE: "WAREHOUSE",
  FARM: "FARM",
} as const;
export type LeadPropertyType = (typeof LeadPropertyType)[keyof typeof LeadPropertyType];

/** Urgencia declarada. Es la señal comercial que más pesa después del interés. */
export const LeadTimeline = {
  NOW: "now",
  ONE_TO_THREE_MONTHS: "1-3m",
  THREE_TO_SIX_MONTHS: "3-6m",
  EXPLORING: "exploring",
} as const;
export type LeadTimeline = (typeof LeadTimeline)[keyof typeof LeadTimeline];

export const LeadFinancing = {
  CASH: "cash",
  MORTGAGE: "mortgage",
  UNKNOWN: "unknown",
} as const;
export type LeadFinancing = (typeof LeadFinancing)[keyof typeof LeadFinancing];

/** Importes en unidades mínimas de la moneda. Enteros, nunca coma flotante. */
export interface LeadBudget {
  readonly min?: number;
  readonly max?: number;
  readonly currency: string;
}

export interface LeadRequirements {
  readonly operation?: LeadOperation;
  readonly propertyTypes?: readonly LeadPropertyType[];
  readonly city?: string;
  readonly neighborhoods?: readonly string[];
  readonly budget?: LeadBudget;
  readonly bedroomsMin?: number;
  readonly timeline?: LeadTimeline;
  readonly financing?: LeadFinancing;
}

export const emptyRequirements = (): LeadRequirements => ({});

/**
 * Fusión: lo nuevo pisa a lo viejo campo por campo, pero un campo ausente NO
 * borra lo que ya había. Un cliente que solo repite la ciudad no debe perder el
 * presupuesto que dio hace diez mensajes.
 */
export const mergeRequirements = (
  current: LeadRequirements,
  incoming: LeadRequirements,
): LeadRequirements => {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  return merged;
};

/** Resumen legible para el asesor, sin depender de ningún formateador de UI. */
export const describeRequirements = (requirements: LeadRequirements): string => {
  const parts: string[] = [];
  if (requirements.operation) {
    parts.push(requirements.operation === LeadOperation.SALE ? "compra" : "arriendo");
  }
  if (requirements.propertyTypes?.length) parts.push(requirements.propertyTypes.join("/"));
  if (requirements.city) parts.push(`en ${requirements.city}`);
  if (requirements.bedroomsMin !== undefined) {
    parts.push(`${String(requirements.bedroomsMin)}+ hab.`);
  }
  return parts.join(" · ");
};
