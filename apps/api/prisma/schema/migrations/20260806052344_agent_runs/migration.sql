-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ESCALATED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentStepType" AS ENUM ('THOUGHT', 'TOOL_CALL', 'TOOL_RESULT', 'MESSAGE', 'GUARDRAIL');

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "failure_reason" TEXT,
    "escalation_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "type" "AgentStepType" NOT NULL,
    "name" TEXT,
    "payload" JSONB NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_turn_id_key" ON "agent_runs"("turn_id");

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_started_at_idx" ON "agent_runs"("conversation_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_started_at_idx" ON "agent_runs"("tenant_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "agent_run_steps_tenant_id_name_idx" ON "agent_run_steps"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_steps_run_id_ordinal_key" ON "agent_run_steps"("run_id", "ordinal");

-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
