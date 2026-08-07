-- CreateTable
CREATE TABLE "tenant_usage_periods" (
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "spent_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_usage_periods_pkey" PRIMARY KEY ("tenant_id","period")
);
