-- Correlación entre nuestros mensajes y los del proveedor.
CREATE TABLE "channel_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_deliveries_provider_message_id_key" ON "channel_deliveries"("provider_message_id");
CREATE INDEX "channel_deliveries_tenant_id_message_id_idx" ON "channel_deliveries"("tenant_id", "message_id");
CREATE INDEX "channel_deliveries_tenant_id_conversation_id_sent_at_idx" ON "channel_deliveries"("tenant_id", "conversation_id", "sent_at" DESC);

-- ---------------------------------------------------------------------------
-- `document_chunks.tsv` deja de ser columna GENERADA.
--
-- Prisma no sabe modelar columnas generadas: en cada migración posterior
-- detectaba una diferencia que no existía e intentaba quitarle la expresión,
-- y Postgres rechazaba el ALTER. Una herramienta que impide migrar es peor que
-- una comodidad.
--
-- El vector lo sigue calculando POSTGRES, no la aplicación: la inserción de
-- fragmentos —que ya era SQL crudo por culpa de pgvector— pasa la expresión
-- `to_tsvector('spanish', f_unaccent(...))` en el propio INSERT. Se conserva
-- la garantía que importaba (un solo sitio decide cómo se indexa el texto) y
-- se recupera la capacidad de migrar.
-- ---------------------------------------------------------------------------
ALTER TABLE "document_chunks" ALTER COLUMN "tsv" DROP EXPRESSION;
