-- CRM Phase 01 - Foundation (2026-10-01).
-- Adds the CRM entity-type enum and the append-only CRM event log that
-- record timelines, workflow triggers and outbound webhooks build on.

-- CreateEnum
CREATE TYPE "CrmEntityType" AS ENUM ('LEAD', 'CONTACT', 'COMPANY', 'OPPORTUNITY');

-- CreateTable
CREATE TABLE "crm_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB,
    "actor_user_id" UUID,
    "correlation_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_events_company_id_entity_type_entity_id_occurred_at_idx" ON "crm_events"("company_id", "entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_events_company_id_event_type_occurred_at_idx" ON "crm_events"("company_id", "event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_events_company_id_occurred_at_idx" ON "crm_events"("company_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
