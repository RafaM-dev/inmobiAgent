import type { AppError } from "../../../../platform/errors/app-error";
import type { Logger } from "../../../../platform/logging/logger";
import { isErr, ok, type Result } from "../../../../platform/result/result";
import { fuseRankings, type FusedChunk } from "../../domain/policies/rank-fusion.policy";
import type {
  ChunkSearchQuery,
  DocumentChunkRepository,
  KnowledgeCollectionRepository,
} from "../../domain/repositories/knowledge.repositories";
import { dedupeByDocument, toExcerpt, type Citation } from "../../domain/value-objects/citation";
import type { EmbeddingProvider } from "../ports/embedding-provider";
import type {
  KnowledgeAnswer,
  KnowledgePassage,
  SearchKnowledgeCommand,
} from "../ports/knowledge-service";

/** Pasajes que se le entregan al modelo. Más no caben en un turno de chat. */
const DEFAULT_TOP_K = 4;

/**
 * Se piden más candidatos a cada carril de los que se van a usar: la fusión
 * necesita ver posiciones para poder reordenar. Con `topK` justos, RRF no
 * tendría nada que fusionar.
 */
const LANE_MULTIPLIER = 3;

/**
 * Coseno mínimo para creer que el carril semántico encontró algo.
 *
 * El vectorial SIEMPRE devuelve sus vecinos más próximos, aunque el más próximo
 * esté lejísimos: sin un suelo, cualquier pregunta "encontraría" el párrafo
 * menos irrelevante del archivo y el agente lo citaría como si respondiera.
 */
const MIN_VECTOR_SCORE = 0.25;

/** Fuentes que se le muestran al cliente. Una lista larga no la lee nadie. */
const MAX_CITATIONS = 2;

/**
 * `SearchKnowledge` — las dos búsquedas y su fusión.
 *
 * Devuelve `found: false` cuando no hay nada defendible que citar. Ese es el
 * `NO_ANSWER` del §13 y la pieza que sostiene el principio 5 del producto: el
 * agente no inventa. Un RAG que siempre devuelve "lo más parecido que encontré"
 * es un generador de respuestas plausibles y falsas.
 */
export class SearchKnowledgeUseCase {
  constructor(
    private readonly deps: {
      chunks: DocumentChunkRepository;
      collections: KnowledgeCollectionRepository;
      embeddings: EmbeddingProvider;
      logger: Logger;
      minVectorScore?: number;
    },
  ) {}

  async execute(command: SearchKnowledgeCommand): Promise<Result<KnowledgeAnswer, AppError>> {
    const question = command.question.trim();
    if (question.length === 0) return ok(empty());

    const topK = command.topK ?? DEFAULT_TOP_K;
    const collectionIds = await this.resolveCollections(command.collectionSlugs);

    // Una colección pedida que no existe no es "buscar en todas": es no buscar.
    if (collectionIds?.length === 0) return ok(empty());

    const embedding = await this.deps.embeddings.embedQuery(question);
    if (isErr(embedding)) return embedding;

    const query: ChunkSearchQuery = {
      text: question,
      embedding: embedding.value,
      embeddingModel: this.deps.embeddings.model,
      ...(collectionIds !== undefined ? { collectionIds } : {}),
      limit: topK * LANE_MULTIPLIER,
    };

    const [vector, text] = await Promise.all([
      this.deps.chunks.searchByVector(query),
      this.deps.chunks.searchByText(query),
    ]);

    /*
     * El carril semántico SIEMPRE devuelve sus vecinos más próximos, aunque el
     * más próximo esté lejísimos. Los que no llegan al suelo se descartan antes
     * de fusionar, no solo para decidir si hay respuesta: si entraran, se
     * colarían en las citas y el agente acabaría citando el reglamento de
     * convivencia al hablar de escrituración.
     *
     * Los del carril léxico no necesitan suelo: contienen los términos.
     */
    const floor = this.deps.minVectorScore ?? MIN_VECTOR_SCORE;
    const relevantVector = vector.filter((match) => match.rawScore >= floor);

    if (relevantVector.length === 0 && text.length === 0) {
      this.deps.logger.debug("Sin respuesta en la base de conocimiento", {
        question: question.slice(0, 80),
        bestVector: vector[0]?.rawScore ?? 0,
      });
      return ok(empty());
    }

    const fused = fuseRankings({ vector: relevantVector, text }).slice(0, topK);

    return ok({
      found: true,
      passages: fused.map(toPassage),
      // Al cliente le sirve saber DE QUÉ documento sale, no de qué párrafo:
      // tres citas del mismo reglamento son una cita. Y más de dos fuentes en
      // un chat dejan de informar y empiezan a estorbar.
      citations: dedupeByDocument(fused.map(toCitation)).slice(0, MAX_CITATIONS),
    });
  }

  /** Slugs → ids. `undefined` significa "todas las colecciones". */
  private async resolveCollections(
    slugs: readonly string[] | undefined,
  ): Promise<readonly string[] | undefined> {
    if (!slugs || slugs.length === 0) return undefined;

    const resolved = await Promise.all(slugs.map((slug) => this.deps.collections.findBySlug(slug)));
    return resolved.filter((collection) => collection !== null).map((collection) => collection.id);
  }
}

const empty = (): KnowledgeAnswer => ({ found: false, passages: [], citations: [] });

const toPassage = (fused: FusedChunk): KnowledgePassage => ({
  chunkId: fused.match.chunkId,
  content: fused.match.content,
  ...(fused.match.heading !== undefined ? { heading: fused.match.heading } : {}),
  documentTitle: fused.match.documentTitle,
  collectionName: fused.match.collectionName,
});

const toCitation = (fused: FusedChunk): Citation => ({
  documentId: fused.match.documentId,
  chunkId: fused.match.chunkId,
  title: fused.match.documentTitle,
  collectionName: fused.match.collectionName,
  score: fused.score,
  excerpt: toExcerpt(fused.match.content),
});
