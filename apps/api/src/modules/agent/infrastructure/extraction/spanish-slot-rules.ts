import {
  moneyFromMajor,
  PropertyKind,
  PropertyOperation,
  type MoneyRange,
  type PropertyKind as PropertyKindType,
  type PropertyOperation as PropertyOperationType,
  type Timeline,
} from "../../../conversation";
import { normalize } from "../../domain/value-objects/intent";

/**
 * Reglas de extracción para español de Colombia.
 *
 * Las usan DOS piezas distintas y por eso viven aquí, sin depender de ninguna:
 *  · el extractor determinista, que corre siempre y marca lo que encuentra
 *    como `inferred` (es una deducción nuestra);
 *  · el `MockLLMProvider`, que simula a un modelo entendiendo el mensaje.
 *
 * No pretenden ser exhaustivas. Pretenden cubrir cómo escribe de verdad la
 * gente por WhatsApp: "busco apto en laureles hasta 450 millones", "arriendo
 * de 2 hab en envigado", "casa 3 alcobas maximo 1.800.000".
 */

export interface ExtractedSlots {
  operation?: PropertyOperationType;
  propertyType?: PropertyKindType[];
  city?: string;
  neighborhoods?: string[];
  budget?: MoneyRange;
  bedrooms?: number;
  bathrooms?: number;
  timeline?: Timeline;
  name?: string;
}

/* -------------------------------------------------------------------------- */

const SALE_HINTS = ["comprar", "compra", "venta", "en venta", "adquirir"];
const RENT_HINTS = ["arrendar", "arriendo", "alquilar", "alquiler", "rentar", "renta mensual"];

/** El orden importa: "apartaestudio" contiene "aparta", y no es un apartamento. */
const PROPERTY_TYPES: readonly (readonly [string, PropertyKindType])[] = [
  ["apartaestudio", PropertyKind.STUDIO],
  ["aparta estudio", PropertyKind.STUDIO],
  ["estudio", PropertyKind.STUDIO],
  ["apartamento", PropertyKind.APARTMENT],
  ["apto", PropertyKind.APARTMENT],
  ["apartaments", PropertyKind.APARTMENT],
  ["casa", PropertyKind.HOUSE],
  ["oficina", PropertyKind.OFFICE],
  ["local", PropertyKind.COMMERCIAL],
  ["bodega", PropertyKind.WAREHOUSE],
  ["lote", PropertyKind.LOT],
  ["finca", PropertyKind.FARM],
];

/**
 * Ciudades y municipios reconocidos. Es una lista y no una heurística de
 * mayúsculas porque "busco en enero" no puede acabar convertido en la ciudad
 * de Enero. Ampliarla es trivial; equivocarse callado, caro.
 */
const CITIES: readonly (readonly [string, string])[] = [
  ["medellin", "Medellín"],
  ["bogota", "Bogotá"],
  ["cali", "Cali"],
  ["barranquilla", "Barranquilla"],
  ["cartagena", "Cartagena"],
  ["bucaramanga", "Bucaramanga"],
  ["pereira", "Pereira"],
  ["manizales", "Manizales"],
  ["armenia", "Armenia"],
  ["santa marta", "Santa Marta"],
  ["envigado", "Envigado"],
  ["sabaneta", "Sabaneta"],
  ["itagui", "Itagüí"],
  ["bello", "Bello"],
  ["rionegro", "Rionegro"],
];

const NEIGHBORHOODS: readonly (readonly [string, string])[] = [
  ["laureles", "Laureles"],
  ["el poblado", "El Poblado"],
  ["poblado", "El Poblado"],
  ["belen", "Belén"],
  ["estadio", "Estadio"],
  ["conquistadores", "Conquistadores"],
  ["robledo", "Robledo"],
  ["la america", "La América"],
  ["chapinero", "Chapinero"],
  ["usaquen", "Usaquén"],
  ["cedritos", "Cedritos"],
  ["granada", "Granada"],
  ["san antonio", "San Antonio"],
];

/* -------------------------------------------------------------------------- */

const findAll = <T>(text: string, table: readonly (readonly [string, T])[]): T[] => {
  const found: T[] = [];
  for (const [needle, value] of table) {
    if (text.includes(needle) && !found.includes(value)) found.push(value);
  }
  return found;
};

/** "450 millones" → 450000000 · "1.800.000" → 1800000 · "2 mill" → 2000000 */
const parseAmount = (raw: string, unit: string | undefined): number | undefined => {
  const digits = raw.replace(/[.,\s]/g, "");
  if (digits.length === 0) return undefined;

  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  if (unit && /^mill?/.test(unit)) return value * 1_000_000;
  if (unit === "m" || unit === "mm") return value * 1_000_000;
  if (unit === "k" || unit === "mil") return value * 1_000;
  return value;
};

const AMOUNT = String.raw`(\d[\d.,\s]*)\s*(millones|millon|mill|mm|m|mil|k)?`;

const extractBudget = (text: string, currency: string): MoneyRange | undefined => {
  const between = new RegExp(String.raw`entre\s+${AMOUNT}\s*(?:y|a)\s+${AMOUNT}`).exec(text);
  if (between) {
    // "entre 300 y 450 millones": la unidad del segundo importe manda para ambos.
    const unit = between[4] ?? between[2];
    const min = parseAmount(between[1] ?? "", unit);
    const max = parseAmount(between[3] ?? "", between[4] ?? unit);
    if (min !== undefined && max !== undefined) {
      return { min: moneyFromMajor(min, currency), max: moneyFromMajor(max, currency), currency };
    }
  }

  const upper = new RegExp(
    String.raw`(?:hasta|maximo|max|menos de|no mas de|tope de|por debajo de)\s+${AMOUNT}`,
  ).exec(text);
  if (upper) {
    const max = parseAmount(upper[1] ?? "", upper[2]);
    if (max !== undefined) return { max: moneyFromMajor(max, currency), currency };
  }

  const lower = new RegExp(String.raw`(?:desde|minimo|min|mas de)\s+${AMOUNT}`).exec(text);
  if (lower) {
    const min = parseAmount(lower[1] ?? "", lower[2]);
    if (min !== undefined) return { min: moneyFromMajor(min, currency), currency };
  }

  // Un importe suelto se interpreta como techo: es como habla la gente
  // ("tengo 450 millones" significa "no más de 450").
  const bare = new RegExp(String.raw`(?:presupuesto|tengo|cuento con|de)\s+${AMOUNT}`).exec(text);
  if (bare) {
    const max = parseAmount(bare[1] ?? "", bare[2]);
    // Se exige unidad o un número grande: "de 3 habitaciones" no es dinero.
    if (max !== undefined && (bare[2] !== undefined || max >= 100_000)) {
      return { max: moneyFromMajor(max, currency), currency };
    }
  }

  return undefined;
};

const extractCount = (text: string, patterns: readonly string[]): number | undefined => {
  const WORDS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

  for (const pattern of patterns) {
    const match = new RegExp(String.raw`(\d+|una?|dos|tres|cuatro|cinco)\s*${pattern}`).exec(text);
    const raw = match?.[1];
    if (!raw) continue;

    const value = WORDS[raw] ?? Number(raw);
    if (Number.isFinite(value) && value > 0 && value <= 20) return value;
  }
  return undefined;
};

const extractTimeline = (text: string): Timeline | undefined => {
  if (/\b(ya|urgente|inmediato|cuanto antes|este mes)\b/.test(text)) return "now";
  if (/\b(dos|tres|2|3)\s*meses\b/.test(text)) return "1-3m";
  if (/\b(cuatro|cinco|seis|4|5|6)\s*meses\b/.test(text)) return "3-6m";
  if (/\b(mirando|explorando|sin afan|sin prisa|por ahora solo)\b/.test(text)) return "exploring";
  return undefined;
};

/**
 * El nombre se busca sobre el texto ORIGINAL, no sobre el normalizado: es el
 * único dato que se guarda tal como la persona lo escribió. "Ana María" no
 * puede acabar en la base como "Ana Maria".
 */
const extractName = (original: string): string | undefined => {
  const match = /(?:me llamo|mi nombre es|soy)\s+([\p{L} ]{2,40})/iu.exec(original);
  const captured = match?.[1]?.trim();
  if (!captured) return undefined;

  // Se recorta al primer conector para no capturar media frase.
  const name = captured.split(/\s+(?:y|de|que|para|desde|pero)\s+/iu)[0]?.trim();
  if (!name || name.length < 2) return undefined;

  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/**
 * Extrae del texto todo lo que se pueda afirmar con seguridad razonable.
 * Lo que no está claro NO se devuelve: preferimos preguntar a asumir.
 */
export const extractSlots = (rawText: string, currency = "COP"): ExtractedSlots => {
  const text = normalize(rawText);
  const slots: ExtractedSlots = {};

  const operation = SALE_HINTS.some((h) => text.includes(h))
    ? PropertyOperation.SALE
    : RENT_HINTS.some((h) => text.includes(h))
      ? PropertyOperation.RENT
      : undefined;
  if (operation) slots.operation = operation;

  const types = findAll(text, PROPERTY_TYPES);
  if (types.length > 0) slots.propertyType = types;

  const cities = findAll(text, CITIES);
  if (cities[0]) slots.city = cities[0];

  const neighborhoods = findAll(text, NEIGHBORHOODS);
  if (neighborhoods.length > 0) slots.neighborhoods = neighborhoods;

  const budget = extractBudget(text, currency);
  if (budget) slots.budget = budget;

  const bedrooms = extractCount(text, ["habitacion", "habitaciones", "alcoba", "alcobas", "cuartos", "hab"]);
  if (bedrooms !== undefined) slots.bedrooms = bedrooms;

  const bathrooms = extractCount(text, ["bano", "banos"]);
  if (bathrooms !== undefined) slots.bathrooms = bathrooms;

  const timeline = extractTimeline(text);
  if (timeline) slots.timeline = timeline;

  const name = extractName(rawText);
  if (name) slots.name = name;

  return slots;
};

export const hasAnySlot = (slots: ExtractedSlots): boolean => Object.keys(slots).length > 0;
