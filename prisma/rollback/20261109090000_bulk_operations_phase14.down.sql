-- Rollback for 20261109090000_bulk_operations_phase14 (the BUYER_ENQUIRY enum value stays: Postgres can't drop enum values; it is harmless).
DROP INDEX IF EXISTS "bulk_jobs_dry_run_of_job_id_key";
DROP INDEX IF EXISTS "bulk_jobs_schedule_id_created_at_idx";
ALTER TABLE "bulk_jobs" DROP CONSTRAINT IF EXISTS "bulk_jobs_schedule_id_fkey";
ALTER TABLE "bulk_jobs" DROP CONSTRAINT IF EXISTS "bulk_jobs_dry_run_of_job_id_fkey";
ALTER TABLE "bulk_jobs" DROP COLUMN IF EXISTS "schedule_id", DROP COLUMN IF EXISTS "dry_run_of_job_id", DROP COLUMN IF EXISTS "dry_run";
DROP TABLE IF EXISTS "bulk_job_schedules";
DROP TYPE IF EXISTS "BulkScheduleStatus";
DROP TYPE IF EXISTS "BulkScheduleFrequency";
