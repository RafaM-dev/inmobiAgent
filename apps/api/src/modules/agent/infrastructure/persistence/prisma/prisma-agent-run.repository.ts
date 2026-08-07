import type {
  AgentRun as PrismaAgentRun,
  AgentRunStep as PrismaAgentRunStep,
} from "../../../../../generated/prisma/client";
import { toJson } from "../../../../../platform/database/json";
import type { Database } from "../../../../../platform/database/prisma";
import { assertWritableTenant, tenantScope } from "../../../../../platform/database/tenant-scope";
import type { IdGenerator } from "../../../../../platform/ids/id-generator";
import { AgentRun } from "../../../domain/entities/agent-run";
import type { AgentRunRepository } from "../../../domain/repositories/agent-run.repository";
import type { AgentStep } from "../../../domain/value-objects/agent-step";

type RowWithSteps = PrismaAgentRun & { steps: PrismaAgentRunStep[] };

const toDomain = (row: RowWithSteps): AgentRun =>
  AgentRun.rehydrate({
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    status: row.status,
    steps: row.steps
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(
        (step): AgentStep => ({
          ordinal: step.ordinal,
          type: step.type,
          name: step.name ?? undefined,
          payload: (step.payload ?? {}) as Record<string, unknown>,
          durationMs: step.durationMs,
          at: step.at,
          error: step.error ?? undefined,
        }),
      ),
    usage: {
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      estimatedCostUsd: Number(row.estimatedCostUsd),
    },
    model: row.model ?? undefined,
    promptVersion: row.promptVersion,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    failureReason: row.failureReason ?? undefined,
    escalationReason: row.escalationReason ?? undefined,
  });

/**
 * Persistencia del AgentRun.
 *
 * Un run se guarda una sola vez, al terminar, con todos sus pasos: durante la
 * ejecución vive en memoria. Escribir paso a paso multiplicaría por seis las
 * escrituras en la tabla más caliente del sistema sin aportar nada — si el
 * proceso muere a mitad de un turno, ese turno no interesa: interesa que el
 * mensaje del cliente siga sin consumir y otro turno lo recoja.
 */
export class PrismaAgentRunRepository implements AgentRunRepository {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async save(run: AgentRun): Promise<void> {
    assertWritableTenant(run.tenantId, "ejecución del agente");
    const data = run.snapshot();
    const client = this.db.client();

    await client.agentRun.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        turnId: data.turnId,
        status: data.status,
        model: data.model ?? null,
        promptVersion: data.promptVersion,
        promptTokens: data.usage.promptTokens,
        completionTokens: data.usage.completionTokens,
        estimatedCostUsd: data.usage.estimatedCostUsd,
        latencyMs: data.latencyMs ?? null,
        failureReason: data.failureReason ?? null,
        escalationReason: data.escalationReason ?? null,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt ?? null,
      },
      update: {
        status: data.status,
        model: data.model ?? null,
        promptTokens: data.usage.promptTokens,
        completionTokens: data.usage.completionTokens,
        estimatedCostUsd: data.usage.estimatedCostUsd,
        latencyMs: data.latencyMs ?? null,
        failureReason: data.failureReason ?? null,
        escalationReason: data.escalationReason ?? null,
        finishedAt: data.finishedAt ?? null,
      },
    });

    if (data.steps.length === 0) return;

    // `skipDuplicates` hace la escritura reintentable: si el guardado se repite
    // tras un fallo parcial, los pasos ya escritos no rompen la operación.
    await client.agentRunStep.createMany({
      skipDuplicates: true,
      data: data.steps.map((step) => ({
        id: this.ids.generate(),
        runId: data.id,
        tenantId: data.tenantId,
        ordinal: step.ordinal,
        type: step.type,
        name: step.name ?? null,
        payload: toJson(step.payload),
        durationMs: step.durationMs,
        error: step.error ?? null,
        at: step.at,
      })),
    });
  }

  async findById(id: string): Promise<AgentRun | null> {
    const row = await this.db.client().agentRun.findFirst({
      where: { id, ...tenantScope() },
      include: { steps: true },
    });
    return row ? toDomain(row) : null;
  }

  async listByConversation(conversationId: string, limit: number): Promise<AgentRun[]> {
    const rows = await this.db.client().agentRun.findMany({
      where: { conversationId, ...tenantScope() },
      include: { steps: true },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return rows.map(toDomain);
  }
}
