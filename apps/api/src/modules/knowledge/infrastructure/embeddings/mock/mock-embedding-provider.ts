import type { AppError } from "../../../../../platform/errors/app-error";
import { ok, type Result } from "../../../../../platform/result/result";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
} from "../../../application/ports/embedding-provider";
import { toTerms } from "../../../domain/value-objects/spanish-terms";

/**
 * `MockEmbeddingProvider` — el RAG del modo demo, sin API key y sin coste.
 *
 * **No son vectores aleatorios.** El documento de arquitectura hablaba de
 * "pseudoaleatorios deterministas por hash", y eso, tomado al pie de la letra,
 * produce un buscador que no encuentra nada: dos textos sobre mascotas
 * quedarían igual de lejos que un texto sobre mascotas y otro sobre impuestos.
 * Un RAG así "funciona" en los tests y falla en la primera demostración.
 *
 * Lo que hace es el *hashing trick*: una proyección aleatoria pero FIJA de la
 * bolsa de palabras. Cada término cae siempre en las mismas dimensiones, con
 * signo, y el vector se normaliza. El resultado tiene una propiedad que sí
 * sirve: **dos textos que comparten vocabulario quedan cerca**. Es un embedding
 * primitivo —no entiende sinónimos ni contexto— pero es un embedding de verdad,
 * determinista y reproducible en cualquier máquina.
 *
 * La parte semántica que le falta la cubre el otro carril de la búsqueda
 * híbrida (full-text de Postgres) y, en producción, un proveedor real.
 */

/** FNV-1a de 32 bits: rápido, estable y sin dependencias. */
const hash32 = (value: string, seed: number): number => {
  let h = 2_166_136_261 ^ seed;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
};

/** Cuántas dimensiones toca cada término. Más de una reparte las colisiones. */
const HASHES_PER_TERM = 3;

const embedText = (text: string, dimensions: number): number[] => {
  const vector = new Array<number>(dimensions).fill(0);
  // La MISMA normalización que usa la búsqueda léxica y que imita a Postgres:
  // dos normalizaciones distintas harían que los carriles no hablen del mismo
  // vocabulario.
  const tokens = toTerms(text);

  for (const token of tokens) {
    for (let seed = 0; seed < HASHES_PER_TERM; seed += 1) {
      const h = hash32(token, seed);
      const index = h % dimensions;
      // El signo también sale del hash: sin él, todos los vectores apuntan al
      // mismo cuadrante y todo se parece a todo.
      const sign = (h >>> 31) % 2 === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
  }

  // Normalización L2: así el coseno depende de QUÉ palabras hay, no de cuántas.
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;

  return vector.map((value) => value / norm);
};

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  /**
   * El nombre lleva versión a propósito: si algún día cambia el algoritmo, los
   * fragmentos indexados con el anterior dejan de mezclarse con los nuevos en
   * vez de degradar la búsqueda en silencio.
   */
  readonly model = "mock-hashing-v1";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  embedDocuments(texts: readonly string[]): Promise<Result<readonly number[][], AppError>> {
    return Promise.resolve(ok(texts.map((text) => embedText(text, this.dimensions))));
  }

  embedQuery(text: string): Promise<Result<readonly number[], AppError>> {
    return Promise.resolve(ok(embedText(text, this.dimensions)));
  }
}
