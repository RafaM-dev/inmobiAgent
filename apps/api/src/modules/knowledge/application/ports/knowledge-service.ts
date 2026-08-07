import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type { Citation } from "../../domain/value-objects/citation";

/**
 * PUERTO PÚBLICO de `knowledge` (docs §8.2, `KnowledgeService`).
 *
 * Una sola operación de lectura: preguntar. La ingesta no está aquí porque no
 * la hace el agente — la hace una persona desde el back-office, y mezclarlas
 * daría al modelo la capacidad de escribir en la base de conocimiento.
 *
 * Devuelve pasajes LITERALES y sus citas. Nunca una respuesta redactada: quien
 * redacta es el modelo, y quien garantiza que lo redactado se apoya en algo es
 * el guardrail de citación.
 */

export interface KnowledgePassage {
  readonly chunkId: string;
  /** Texto literal del documento. Es lo único que el modelo puede parafrasear. */
  readonly content: string;
  readonly heading?: string;
  readonly documentTitle: string;
  readonly collectionName: string;
}

export interface SearchKnowledgeCommand {
  readonly question: string;
  /** Acota la búsqueda a ciertas colecciones. Vacío = todas. */
  readonly collectionSlugs?: readonly string[];
  readonly topK?: number;
}

export interface KnowledgeAnswer {
  /**
   * `false` cuando la base de conocimiento no tiene nada que decir. Es el
   * `NO_ANSWER` del documento de arquitectura, y es un resultado válido: obliga
   * al agente a admitir que no sabe en vez de improvisar.
   */
  readonly found: boolean;
  readonly passages: readonly KnowledgePassage[];
  readonly citations: readonly Citation[];
}

export interface KnowledgeService {
  search(command: SearchKnowledgeCommand): Promise<Result<KnowledgeAnswer, AppError>>;
}
