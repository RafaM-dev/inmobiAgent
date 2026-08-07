/**
 * Un dato recordado del cliente, con su procedencia y su confianza.
 *
 * La procedencia es lo que hace que la memoria sea auditable y corregible: no
 * es lo mismo que el cliente diga "quiero en Envigado" (`user`) a que el
 * sistema lo deduzca de que preguntó por tres inmuebles allí (`inferred`). Sin
 * esta distinción, una inferencia dudosa pisa un dato explícito y el cliente
 * recibe recomendaciones que no pidió.
 */
export const SlotSource = {
  /** Lo dijo el cliente. Es la verdad. */
  USER: "user",
  /** Lo dedujo el sistema. Cede ante cualquier dato del cliente. */
  INFERRED: "inferred",
  /** Lo escribió un asesor humano en el back-office. */
  ADVISOR: "advisor",
  /** Vino de un sistema externo del tenant. */
  CRM: "crm",
} as const;
export type SlotSource = (typeof SlotSource)[keyof typeof SlotSource];

/** Prioridad ante conflicto. Mayor gana. */
const SOURCE_RANK: Record<SlotSource, number> = {
  user: 3,
  advisor: 3,
  crm: 2,
  inferred: 1,
};

export interface ProfileSlot<T> {
  readonly value: T;
  /** 0..1 */
  readonly confidence: number;
  readonly source: SlotSource;
  readonly updatedAt: Date;
}

export const slot = <T>(
  value: T,
  source: SlotSource,
  updatedAt: Date,
  confidence = source === SlotSource.INFERRED ? 0.6 : 1,
): ProfileSlot<T> => ({ value, confidence, source, updatedAt });

/**
 * Regla de fusión (docs §11.1). Función pura, y por eso testeable al detalle:
 *
 * 1. Una fuente de mayor rango siempre gana (el cliente manda sobre la inferencia).
 * 2. A igual rango, gana el más reciente — el cliente puede corregirse
 *    ("no, mejor en Envigado") y el sistema lo respeta sin ambigüedad.
 * 3. A igual rango y misma marca de tiempo, gana la mayor confianza.
 *
 * Nada de esto depende del modelo de IA: con MockLLM o con GPT-5, la memoria se
 * comporta igual.
 */
export const mergeSlot = <T>(
  current: ProfileSlot<T> | undefined,
  incoming: ProfileSlot<T>,
): ProfileSlot<T> => {
  if (!current) return incoming;

  const currentRank = SOURCE_RANK[current.source];
  const incomingRank = SOURCE_RANK[incoming.source];

  if (incomingRank > currentRank) return incoming;
  if (incomingRank < currentRank) return current;

  if (incoming.updatedAt.getTime() > current.updatedAt.getTime()) return incoming;
  if (incoming.updatedAt.getTime() < current.updatedAt.getTime()) return current;

  return incoming.confidence >= current.confidence ? incoming : current;
};
