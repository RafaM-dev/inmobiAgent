-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'BOT_PAUSED', 'HUMAN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationStage" AS ENUM ('NEW', 'DISCOVERY', 'SEARCHING', 'PRESENTING', 'SCHEDULING', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageAuthorType" AS ENUM ('CONTACT', 'AGENT', 'HUMAN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_phone" TEXT,
    "email" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es-CO',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel_type" "ChannelType" NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "channel_type" "ChannelType" NOT NULL,
    "external_contact_id" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "stage" "ConversationStage" NOT NULL DEFAULT 'NEW',
    "assigned_user_id" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author_type" "MessageAuthorType" NOT NULL,
    "author_id" TEXT,
    "blocks" JSONB NOT NULL,
    "external_message_id" TEXT,
    "provider_message_id" TEXT,
    "status" "MessageStatus" NOT NULL,
    "turn_id" TEXT,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_profiles" (
    "contact_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '{}',
    "free_notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_profiles_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "profile_facts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_updated_at_idx" ON "contacts"("tenant_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_primary_phone_idx" ON "contacts"("tenant_id", "primary_phone");

-- CreateIndex
CREATE INDEX "contact_identities_tenant_id_contact_id_idx" ON "contact_identities"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_channel_type_external_id_key" ON "contact_identities"("channel_type", "external_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_last_activity_at_idx" ON "conversations"("tenant_id", "status", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_contact_id_channel_account_id_status_idx" ON "conversations"("contact_id", "channel_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_external_message_id_key" ON "messages"("external_message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_turn_id_idx" ON "messages"("conversation_id", "turn_id");

-- CreateIndex
CREATE INDEX "contact_profiles_tenant_id_updated_at_idx" ON "contact_profiles"("tenant_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "profile_facts_tenant_id_contact_id_recorded_at_idx" ON "profile_facts"("tenant_id", "contact_id", "recorded_at" DESC);

-- AddForeignKey
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_profiles" ADD CONSTRAINT "contact_profiles_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact_profiles"("contact_id") ON DELETE CASCADE ON UPDATE CASCADE;
