/**
 * Intención del cliente en este turno.
 *
 * Se clasifica con reglas deterministas y NO con el modelo, por tres razones:
 * cuesta cero, tarda cero y da el mismo resultado siempre. Una clasificación
 * que decide si hay que escalar a un humano no puede depender de la
 * temperatura de un LLM.
 *
 * El modelo sigue siendo quien redacta; esto solo decide por qué carril va el
 * turno.
 */
export const Intent = {
  GREETING: "GREETING",
  SEARCH: "SEARCH",
  QUESTION: "QUESTION",
  FAQ: "FAQ",
  SCHEDULE: "SCHEDULE",
  HANDOFF: "HANDOFF",
  SMALLTALK: "SMALLTALK",
  /** Fuera de lo que el agente puede resolver: legal, precio, reclamo. */
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
} as const;
export type Intent = (typeof Intent)[keyof typeof Intent];

/** Sin tildes y en minúsculas: la gente escribe "medellin" y "Medellín". */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    // NFD separa la tilde de la letra; aquí se descarta la tilde suelta.
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const has = (text: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => text.includes(pattern));

const HANDOFF = [
  "hablar con una persona",
  "hablar con alguien",
  "un humano",
  "una persona real",
  "asesor real",
  "atencion al cliente",
  "quiero hablar con un asesor",
  "pasame con",
  "comunicame con",
];

const OUT_OF_SCOPE = [
  "demanda",
  "abogado",
  "juridic",
  "escritura",
  "notaria",
  "queja",
  "reclamo",
  "denuncia",
  "estafa",
  "devolucion del dinero",
  "rebaja",
  "descuento",
  "negociar el precio",
];

const SCHEDULE = [
  "visita",
  "visitar",
  "agendar",
  "cita",
  "ver el apartamento",
  "ver la casa",
  "conocer el inmueble",
  "cuando puedo ir",
];

const SEARCH = [
  "busco",
  "buscando",
  "quiero comprar",
  "quiero arrendar",
  "quiero alquilar",
  "necesito un",
  "necesito una",
  "apartamento",
  "apartaestudio",
  "casa",
  "local",
  "oficina",
  "lote",
  "finca",
  "bodega",
  "arriendo",
  "venta",
];

const GREETING = ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "que tal"];

const QUESTION_HINTS = ["?", "cuanto", "como", "cuando", "donde", "que ", "cual", "por que"];

/**
 * Orden deliberado: primero lo que obliga a salirse del carril automático.
 * Si alguien pide un humano mientras describe lo que busca, gana el humano.
 */
export const classifyIntent = (rawText: string): Intent => {
  const text = normalize(rawText);
  if (text.length === 0) return Intent.SMALLTALK;

  if (has(text, HANDOFF)) return Intent.HANDOFF;
  if (has(text, OUT_OF_SCOPE)) return Intent.OUT_OF_SCOPE;
  if (has(text, SCHEDULE)) return Intent.SCHEDULE;
  if (has(text, SEARCH)) return Intent.SEARCH;

  // El saludo solo gana si el mensaje es prácticamente solo un saludo: "hola,
  // busco apartamento" es una búsqueda, no un saludo.
  if (has(text, GREETING) && text.length <= 25) return Intent.GREETING;

  if (has(text, QUESTION_HINTS)) return Intent.QUESTION;
  return Intent.SMALLTALK;
};
