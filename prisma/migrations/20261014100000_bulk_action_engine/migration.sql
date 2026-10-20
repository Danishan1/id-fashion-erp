-- Phase 14 (2026-10-14): Reusable Bulk Action Engine.
-- See docs/crm/PHASE_14_BULK_ACTION_ENGINE.md.
--
-- bulk_jobs        one row per bulk request (entity type + action key from the
--                  code registry, selection, validated params, status,
--                  counters, worker lease, output such as an export file).
-- bulk_job_items   one row per target record with its own outcome — partial
--                  success, retry of failed items and crash recovery are all
--                  item-level. A FILTER selection is snapshotted here once.

CREATE TYPE "BulkJobStatus" AS ENUM ('QUEUED', 'VALIDATING', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');
CREATE TYPE "BulkJobItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

CREATE TABLE "bulk_jobs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "action_key" TEXT NOT NULL,
    "status" "BulkJobStatus" NOT NULL DEFAULT 'QUEUED',
    "selection_mode" TEXT NOT NULL,
    "selection" JSONB NOT NULL DEFAULT '{}',
    "params" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "succeeded_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "retry_of_job_id" UUID,
    "lock_token" UUID,
    "locked_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "cancel_requested_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bulk_jobs_selection_mode_check" CHECK ("selection_mode" IN ('IDS', 'PAGE', 'FILTER')),
    CONSTRAINT "bulk_jobs_counts_check" CHECK ("total_count" >= 0 AND "processed_count" >= 0 AND "succeeded_count" >= 0 AND "failed_count" >= 0 AND "skipped_count" >= 0)
);

CREATE TABLE "bulk_job_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" "BulkJobItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error_code" TEXT,
    "result" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bulk_jobs_company_id_requested_by_user_id_idempotency_key_key" ON "bulk_jobs"("company_id", "requested_by_user_id", "idempotency_key");
CREATE INDEX "bulk_jobs_company_id_created_at_idx" ON "bulk_jobs"("company_id", "created_at");
CREATE INDEX "bulk_jobs_company_id_requested_by_user_id_created_at_idx" ON "bulk_jobs"("company_id", "requested_by_user_id", "created_at");
CREATE INDEX "bulk_jobs_status_locked_at_idx" ON "bulk_jobs"("status", "locked_at");

CREATE UNIQUE INDEX "bulk_job_items_job_id_entity_id_key" ON "bulk_job_items"("job_id", "entity_id");
CREATE UNIQUE INDEX "bulk_job_items_job_id_sequence_key" ON "bulk_job_items"("job_id", "sequence");
CREATE INDEX "bulk_job_items_job_id_status_sequence_idx" ON "bulk_job_items"("job_id", "status", "sequence");

ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_retry_of_job_id_fkey" FOREIGN KEY ("retry_of_job_id") REFERENCES "bulk_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "bulk_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
