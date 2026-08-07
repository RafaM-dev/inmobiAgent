-- DropIndex
DROP INDEX "contact_identities_channel_type_external_id_key";

-- DropIndex
DROP INDEX "messages_external_message_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_tenant_id_channel_type_external_id_key" ON "contact_identities"("tenant_id", "channel_type", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_external_message_id_key" ON "messages"("tenant_id", "external_message_id");