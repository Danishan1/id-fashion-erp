-- CRM Phase 09 — Activities, Tasks & Follow-ups.
-- Additive only. The ERP has no task / activity module, so activities get
-- their own tables; notes stay in crm_notes, reminders go through the
-- existing notifications table, history through crm_events + audit_logs.

-- New CRM record type for activity events (activity.*), and a notification /
-- attachment target for activities.
ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'ACTIVITY';
ALTER TYPE "RelatedModule" ADD VALUE IF NOT EXISTS 'CRM_ACTIVITY';

CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "entity_type" "CrmEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "due_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "end_at" TIMESTAMP(3),
    "original_due_at" TIMESTAMP(3),
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "reminder_offset_minutes" INTEGER,
    "reminder_at" TIMESTAMP(3),
    "reminder_state" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "outcome" TEXT,
    "direction" TEXT,
    "duration_minutes" INTEGER,
    "location" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by_user_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "external_ref" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_activities_status_check" CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "crm_activities_priority_check" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT "crm_activities_reminder_state_check" CHECK ("reminder_state" IS NULL OR "reminder_state" IN ('PENDING', 'SENT', 'CANCELLED')),
    CONSTRAINT "crm_activities_direction_check" CHECK ("direction" IS NULL OR "direction" IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT "crm_activities_completed_check" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
    CONSTRAINT "crm_activities_end_check" CHECK ("end_at" IS NULL OR ("due_at" IS NOT NULL AND "end_at" >= "due_at")),
    CONSTRAINT "crm_activities_reminder_offset_check" CHECK ("reminder_offset_minutes" IS NULL OR "reminder_offset_minutes" >= 0),
    CONSTRAINT "crm_activities_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0),
    CONSTRAINT "crm_activities_metadata_check" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "crm_activities_assignee_idx" ON "crm_activities"("company_id", "assigned_to_user_id", "status", "due_at");
CREATE INDEX "crm_activities_due_idx" ON "crm_activities"("company_id", "status", "due_at");
CREATE INDEX "crm_activities_entity_idx" ON "crm_activities"("company_id", "entity_type", "entity_id", "created_at");
CREATE INDEX "crm_activities_type_idx" ON "crm_activities"("company_id", "type", "created_at");
CREATE INDEX "crm_activities_creator_idx" ON "crm_activities"("company_id", "created_by_user_id", "created_at");
-- The reminder job scans only scheduled reminders.
CREATE INDEX "crm_activities_reminder_due_idx" ON "crm_activities"("reminder_at") WHERE "reminder_state" = 'PENDING';
-- A future integration logs each external message / call once.
CREATE UNIQUE INDEX "crm_activities_external_ref_key" ON "crm_activities"("company_id", "source", "external_ref") WHERE "external_ref" IS NOT NULL;

ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crm_activity_links" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activity_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_activity_links_unique" ON "crm_activity_links"("activity_id", "entity_type", "entity_id");
CREATE INDEX "crm_activity_links_entity_idx" ON "crm_activity_links"("company_id", "entity_type", "entity_id", "activity_id");
ALTER TABLE "crm_activity_links" ADD CONSTRAINT "crm_activity_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_activity_links" ADD CONSTRAINT "crm_activity_links_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "crm_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
