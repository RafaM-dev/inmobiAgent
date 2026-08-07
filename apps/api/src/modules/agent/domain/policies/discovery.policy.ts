import type { ProfileSlotName, ProfileSlots } from "../../../conversation";

/**
 * Orden en que se piden los datos que faltan.
 *
 * No es alfabético ni arbitrario: es el orden en que un asesor humano
 * pregunta. Primero qué operación (comprar o arrendar), porque cambia todo lo
 * demás; luego dónde; luego qué tipo de inmueble; el presupuesto al final,
 * porque preguntarlo de entrada suena a filtro y espanta al cliente.
 */
const ASK_ORDER: readonly ProfileSlotName[] = [
  "operation",
  "city",
  "propertyType",
  "budget",
  "bedrooms",
];

/** Datos sin los cuales no tiene sentido buscar (docs §12.1, etapa DISCOVERY). */
const REQUIRED: readonly ProfileSlotName[] = ["operation", "city", "propertyType", "budget"];

/** Máximo de datos por mensaje. Un interrogatorio de cinco preguntas no se responde. */
export const MAX_QUESTIONS_PER_TURN = 2;

export interface DiscoveryPlan {
  readonly missing: readonly ProfileSlotName[];
  /** Lo que toca preguntar AHORA: como mucho dos cosas. */
  readonly ask: readonly ProfileSlotName[];
  readonly readyToSearch: boolean;
}

/**
 * Qué falta y qué se pregunta en este turno.
 *
 * Función pura sobre el perfil: el mismo perfil produce siempre el mismo plan,
 * con MockLLM o con GPT-5. El modelo redacta la pregunta; QUÉ se pregunta lo
 * decide esto (docs §11.1, "por qué esto importa").
 */
export const planDiscovery = (slots: Readonly<ProfileSlots>): DiscoveryPlan => {
  const missing = ASK_ORDER.filter((name) => slots[name] === undefined);
  const missingRequired = REQUIRED.filter((name) => slots[name] === undefined);

  return {
    missing,
    ask: missingRequired.slice(0, MAX_QUESTIONS_PER_TURN),
    readyToSearch: missingRequired.length === 0,
  };
};

/**
 * Cómo se pregunta cada dato, en español natural.
 *
 * Vive junto a la política y no en el prompt del modelo por una razón concreta:
 * es texto que el negocio querrá afinar (y traducir en F10) sin tocar prompts
 * ni arriesgarse a que el modelo lo reformule de forma incómoda.
 */
const QUESTIONS: Record<ProfileSlotName, string> = {
  operation: "¿Estás buscando para comprar o para arrendar?",
  city: "¿En qué ciudad la estás buscando?",
  propertyType: "¿Qué tipo de inmueble te interesa? (apartamento, casa, apartaestudio…)",
  budget: "¿Qué presupuesto tienes en mente?",
  bedrooms: "¿Cuántas habitaciones necesitas?",
  bathrooms: "¿Cuántos baños necesitas?",
  neighborhoods: "¿Tienes algún barrio o zona en mente?",
  areaM2: "¿Qué área aproximada buscas, en metros cuadrados?",
  features: "¿Hay algo que no pueda faltar? (parqueadero, ascensor, terraza…)",
  timeline: "¿Para cuándo lo necesitas?",
  financing: "¿Lo pagarías de contado o con crédito?",
  name: "¿Cómo te llamas?",
  consent: "¿Te parece bien que guarde tus datos para contactarte?",
};

export const questionFor = (slot: ProfileSlotName): string => QUESTIONS[slot];

/** Une hasta dos preguntas en una frase que no suene a formulario. */
export const composeQuestions = (slots: readonly ProfileSlotName[]): string => {
  if (slots.length === 0) return "";
  const [first] = slots;
  if (slots.length === 1 && first) return questionFor(first);
  return slots.map((slot) => questionFor(slot)).join(" ");
};
