/**
 * CITA — de dónde salió lo que el agente acaba de afirmar.
 *
 * Es el equivalente en conocimiento de lo que la ficha de inmueble es en
 * catálogo: el dato NO lo escribe el modelo, se renderiza desde lo que devolvió
 * la herramienta. Un agente que responde "sí, aceptan mascotas" sin poder decir
 * en qué documento lo leyó está adivinando, y adivinar sobre las condiciones de
 * un contrato es exactamente lo que este producto no puede hacer.
 */
export interface Citation {
  readonly documentId: string;
  readonly chunkId: string;
  /** Título del documento, para que el cliente sepa qué se le está citando. */
  readonly title: string;
  readonly collectionName: string;
  /** Puntuación de la fusión híbrida. Mayor es mejor; no es un porcentaje. */
  readonly score: number;
  /** Trozo literal del documento. Nunca texto reescrito. */
  readonly excerpt: string;
}

/** Longitud del extracto: suficiente para reconocerlo, corto para un chat. */
const EXCERPT_LENGTH = 220;

/**
 * Recorta un fragmento a un extracto legible, cortando por palabra y sin
 * inventar puntuación. Es texto literal del documento: si se recorta, se marca.
 */
export const toExcerpt = (content: string, maxLength = EXCERPT_LENGTH): string => {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;

  const cut = clean.lastIndexOf(" ", maxLength);
  return `${clean.slice(0, cut > maxLength * 0.6 ? cut : maxLength).trim()}…`;
};

/**
 * Une citas del mismo documento: al cliente no le sirve ver tres veces
 * "Reglamento de convivencia". Se conserva la de mayor puntuación.
 */
export const dedupeByDocument = (citations: readonly Citation[]): Citation[] => {
  const best = new Map<string, Citation>();

  for (const citation of citations) {
    const current = best.get(citation.documentId);
    if (!current || citation.score > current.score) best.set(citation.documentId, citation);
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
};
