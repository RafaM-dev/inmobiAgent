import type { ChunkMatch } from "../repositories/knowledge.repositories";

/**
 * FUSIÓN DE RANKINGS (RRF — Reciprocal Rank Fusion).
 *
 * La búsqueda tiene dos carriles: uno semántico (coseno sobre vectores) y otro
 * léxico (full-text de Postgres). Cada uno acierta donde el otro falla — el
 * vectorial entiende "¿puedo llevar mi perro?" sin que aparezca la palabra
 * "perro"; el léxico encuentra "cláusula 7.3" y nombres propios, que a un
 * vector le dan igual.
 *
 * **Por qué se fusiona por POSICIÓN y no por puntuación.** Un coseno de 0,82 y
 * un `ts_rank` de 0,19 no son comparables: viven en escalas distintas y no
 * significan lo mismo. Sumarlos, o normalizarlos y sumarlos, produce un orden
 * que depende de cómo estaban repartidas las puntuaciones ese día. RRF ignora
 * los valores y usa solo el puesto: si algo sale primero en un carril y quinto
 * en el otro, es mejor que lo que sale tercero solo en uno.
 *
 * `k = 60` es el valor del artículo original de Cormack et al. y el que usa
 * todo el mundo: amortigua las primeras posiciones para que un carril no pueda
 * imponer su primer resultado por sí solo.
 */

export const RRF_K = 60;

export type SearchLane = "vector" | "text";

export interface FusedChunk {
  readonly match: ChunkMatch;
  /** Puntuación RRF. Sirve para ordenar; NO es una probabilidad ni un %. */
  readonly score: number;
  /** Carriles que lo encontraron. Que sea más de uno es una señal fuerte. */
  readonly lanes: readonly SearchLane[];
}

export interface FusionInput {
  readonly vector: readonly ChunkMatch[];
  readonly text: readonly ChunkMatch[];
  readonly k?: number;
}

export const fuseRankings = (input: FusionInput): FusedChunk[] => {
  const k = input.k ?? RRF_K;
  const accumulated = new Map<string, { match: ChunkMatch; score: number; lanes: SearchLane[] }>();

  const absorb = (matches: readonly ChunkMatch[], lane: SearchLane): void => {
    matches.forEach((match, index) => {
      const contribution = 1 / (k + index + 1);
      const current = accumulated.get(match.chunkId);

      if (current) {
        current.score += contribution;
        if (!current.lanes.includes(lane)) current.lanes.push(lane);
        return;
      }

      accumulated.set(match.chunkId, { match, score: contribution, lanes: [lane] });
    });
  };

  absorb(input.vector, "vector");
  absorb(input.text, "text");

  return [...accumulated.values()]
    .map((entry): FusedChunk => ({ match: entry.match, score: entry.score, lanes: entry.lanes }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Desempate estable: sin esto, dos fragmentos empatados podrían salir en
      // distinto orden en dos ejecuciones y las citas dejarían de ser reproducibles.
      return a.match.chunkId.localeCompare(b.match.chunkId);
    });
};
