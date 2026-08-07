import type { AppError } from "../../../../platform/errors/app-error";
import type { Result } from "../../../../platform/result/result";
import type {
  KnowledgeAnswer,
  KnowledgeService,
  SearchKnowledgeCommand,
} from "../ports/knowledge-service";
import type { SearchKnowledgeUseCase } from "../use-cases/search-knowledge.use-case";

/** Implementación del puerto público. Delega; no decide nada. */
export class KnowledgeServiceFacade implements KnowledgeService {
  constructor(private readonly deps: { search: SearchKnowledgeUseCase }) {}

  search(command: SearchKnowledgeCommand): Promise<Result<KnowledgeAnswer, AppError>> {
    return this.deps.search.execute(command);
  }
}
