-- Phase 14 (Sales & Marketing): shared bulk operations — dry runs, saved
-- schedules, enquiry CSV import. See docs/sales-marketing/PHASE_14_BULK_OPERATIONS.md.

ALTER TYPE "ImportBatchType" ADD VALUE IF NOT EXISTS 'BUYER_ENQUIRY';

CREATE TYPE "BulkScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "BulkScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "bulk_job_schedules" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "action_key" TEXT NOT NULL,
  "filter_query" TEXT NOT NULL DEFAULT '',
  "params" JSONB NOT NULL DEFAULT '{}',
  "summary" TEXT,
  "frequency" "BulkScheduleFrequency" NOT NULL,
  "time_of_day" TEXT NOT NULL,
  "day_of_week" INTEGER,
  "day_of_month" INTEGER,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "status" "BulkScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "next_run_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "last_job_id" UUID,
  "last_outcome" TEXT,
  "last_message" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bulk_job_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bulk_job_schedules_time_check" CHECK ("time_of_day" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "bulk_job_schedules_dow_check" CHECK ("frequency" <> 'WEEKLY' OR ("day_of_week" BETWEEN 1 AND 7)),
  CONSTRAINT "bulk_job_schedules_dom_check" CHECK ("frequency" <> 'MONTHLY' OR ("day_of_month" BETWEEN 1 AND 28))
);
CREATE INDEX "bulk_job_schedules_status_next_run_at_idx" ON "bulk_job_schedules"("status", "next_run_at");
CREATE INDEX "bulk_job_schedules_company_id_entity_type_created_at_idx" ON "bulk_job_schedules"("company_id", "entity_type", "created_at");
ALTER TABLE "bulk_job_schedules" ADD CONSTRAINT "bulk_job_schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bulk_jobs" ADD COLUMN "dry_run" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bulk_jobs" ADD COLUMN "dry_run_of_job_id" UUID;
ALTER TABLE "bulk_jobs" ADD COLUMN "schedule_id" UUID;
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_dry_run_of_job_id_fkey" FOREIGN KEY ("dry_run_of_job_id") REFERENCES "bulk_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "bulk_job_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "bulk_jobs_schedule_id_created_at_idx" ON "bulk_jobs"("schedule_id", "created_at");
-- One real run per dry run.
CREATE UNIQUE INDEX "bulk_jobs_dry_run_of_job_id_key" ON "bulk_jobs"("dry_run_of_job_id") WHERE "dry_run_of_job_id" IS NOT NULL;
