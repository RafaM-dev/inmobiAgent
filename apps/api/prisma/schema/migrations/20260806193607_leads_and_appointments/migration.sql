-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'SCHEDULED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadBand" AS ENUM ('COLD', 'WARM', 'HOT');

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "property_ref" TEXT,
    "status" "AppointmentStatus" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "assigned_user_id" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL,
    "requirements" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "band" "LeadBand" NOT NULL DEFAULT 'COLD',
    "score_reasons" JSONB NOT NULL,
    "assigned_user_id" TEXT,
    "consent_data_processing" BOOLEAN NOT NULL DEFAULT true,
    "consent_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_granted_at" TIMESTAMP(3),
    "visit_requested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_property_interests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "property_ref" TEXT NOT NULL,
    "first_shown_at" TIMESTAMP(3) NOT NULL,
    "last_shown_at" TIMESTAMP(3) NOT NULL,
    "times_shown" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lead_property_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_scheduled_at_idx" ON "appointments"("tenant_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_conversation_id_status_idx" ON "appointments"("tenant_id", "conversation_id", "status");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_assigned_user_id_scheduled_at_idx" ON "appointments"("tenant_id", "assigned_user_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_status_reminder_sent_at_scheduled_at_idx" ON "appointments"("status", "reminder_sent_at", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointment_events_tenant_id_appointment_id_occurred_at_idx" ON "appointment_events"("tenant_id", "appointment_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_last_activity_at_idx" ON "leads"("tenant_id", "status", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_user_id_status_idx" ON "leads"("tenant_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_band_score_idx" ON "leads"("tenant_id", "band", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_conversation_id_key" ON "leads"("tenant_id", "conversation_id");

-- CreateIndex
CREATE INDEX "lead_property_interests_tenant_id_property_ref_idx" ON "lead_property_interests"("tenant_id", "property_ref");

-- CreateIndex
CREATE UNIQUE INDEX "lead_property_interests_lead_id_property_ref_key" ON "lead_property_interests"("lead_id", "property_ref");

-- CreateIndex
CREATE INDEX "lead_events_tenant_id_lead_id_occurred_at_idx" ON "lead_events"("tenant_id", "lead_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_property_interests" ADD CONSTRAINT "lead_property_interests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
