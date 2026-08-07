import type { AgentRun } from "../entities/agent-run";

/**
 * Persistencia de las ejecuciones del agente.
 *
 * `save` guarda el run y sus pasos: son un solo agregado y se escriben juntos.
 * `listByConversation` alimenta el playground del back-office (F7), donde un
 * asesor podrá ver por qué el agente respondió lo que respondió.
 */
export interface AgentRunRepository {
  save(run: AgentRun): Promise<void>;
  findById(id: string): Promise<AgentRun | null>;
  listByConversation(conversationId: string, limit: number): Promise<AgentRun[]>;
}
