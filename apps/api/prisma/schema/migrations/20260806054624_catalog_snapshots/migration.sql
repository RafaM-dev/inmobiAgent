-- CreateEnum
CREATE TYPE "CatalogOperation" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "CatalogPropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'STUDIO', 'OFFICE', 'COMMERCIAL', 'LOT', 'WAREHOUSE', 'FARM');

-- CreateTable
CREATE TABLE "property_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "operation" "CatalogOperation" NOT NULL,
    "type" "CatalogPropertyType" NOT NULL,
    "price_amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "neighborhood" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "area_m2" INTEGER,
    "image_url" TEXT,
    "url" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_impressions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "shown_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_snapshots_tenant_id_source_external_id_idx" ON "property_snapshots"("tenant_id", "source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_snapshots_tenant_id_source_external_id_checksum_key" ON "property_snapshots"("tenant_id", "source", "external_id", "checksum");

-- CreateIndex
CREATE INDEX "property_impressions_tenant_id_conversation_id_shown_at_idx" ON "property_impressions"("tenant_id", "conversation_id", "shown_at" DESC);

-- CreateIndex
CREATE INDEX "property_impressions_tenant_id_contact_id_shown_at_idx" ON "property_impressions"("tenant_id", "contact_id", "shown_at" DESC);

-- AddForeignKey
ALTER TABLE "property_impressions" ADD CONSTRAINT "property_impressions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "property_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
