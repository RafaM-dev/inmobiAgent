-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('CONSOLE', 'WEBCHAT', 'WHATSAPP', 'TELEGRAM', 'MESSENGER', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ChannelAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_type" "ChannelType" NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "ChannelAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_accounts_tenant_id_channel_type_idx" ON "channel_accounts"("tenant_id", "channel_type");

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_channel_type_external_id_key" ON "channel_accounts"("channel_type", "external_id");
