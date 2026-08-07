import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";

/**
 * PUERTO `EmbeddingProvider` — convertir texto en vectores.
 *
 * La misma disciplina que `LLMProvider`: el módulo no sabe si detrás hay
 * OpenAI, un modelo local por Ollama o el simulador determinista del modo demo.
 * `EMBEDDING_PROVIDER=openai` y no cambia ni un caso de uso.
 *
 * **`model` y `dimensions` forman parte del contrato, y no por elegancia.**
 * Comparar por coseno un vector de un modelo con el de otro no da un resultado
 * malo: da un resultado sin significado, y encima con aspecto de funcionar. Por
 * eso cada fragmento guarda con qué modelo se generó y la búsqueda solo compara
 * dentro del mismo espacio (decisión D25).
 *
 * Dos métodos y no uno porque la distinción es real: varios modelos modernos
 * vectorizan distinto una pregunta ("¿aceptan mascotas?") y un documento ("El
 * reglamento permite mascotas hasta 15 kg"). Un proveedor al que le dé igual
 * implementa los dos con el mismo código y no pierde nada.
 */
export interface EmbeddingProvider {
  /** Identificador del adaptador: `mock`, `openai`, `ollama`. */
  readonly id: string;
  /**
   * Modelo concreto. Se persiste con cada fragmento; cambiarlo obliga a
   * reindexar, y el sistema lo detecta en vez de devolver ruido.
   */
  readonly model: string;
  readonly dimensions: number;

  /** Vectoriza fragmentos de documento. En lote: uno a uno es lento y caro. */
  embedDocuments(texts: readonly string[]): Promise<Result<readonly number[][], AppError>>;

  /** Vectoriza la pregunta de un cliente. */
  embedQuery(text: string): Promise<Result<readonly number[], AppError>>;
}

/**
 * Dimensión de la columna `vector` en la base.
 *
 * Fijada en 1536 —la de los modelos de OpenAI— aunque el simulador podría usar
 * muchas menos: así pasar a un proveedor real es reindexar, no migrar el
 * esquema. Un proveedor con otra dimensión (768 en varios modelos locales)
 * necesitará su propia migración, y es mejor que eso se sepa al elegirlo.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** Similitud coseno. Vive aquí porque es parte de cómo se leen estos vectores. */
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
