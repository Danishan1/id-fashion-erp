-- CRM Phase 03 — Lead Import & Capture. Additive only.

-- CreateEnum
CREATE TYPE "CrmLeadCaptureChannel" AS ENUM ('MANUAL', 'CSV', 'XLSX', 'WEBSITE_FORM', 'API', 'WEBHOOK', 'INTEGRATION');
CREATE TYPE "CrmImportFileType" AS ENUM ('CSV', 'XLSX');
CREATE TYPE "CrmImportJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'READY', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CrmDuplicatePolicy" AS ENUM ('SKIP', 'UPDATE', 'CREATE', 'FLAG_FOR_REVIEW');
CREATE TYPE "CrmImportRowValidation" AS ENUM ('PENDING', 'VALID', 'WARNING', 'ERROR');
CREATE TYPE "CrmIngestOutcome" AS ENUM ('PENDING', 'IMPORTED', 'UPDATED', 'SKIPPED', 'FLAGGED', 'FAILED');
CREATE TYPE "CrmIngestEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FLAGGED', 'FAILED');

-- AlterTable: capture attribution on leads (existing leads were all entered manually)
ALTER TABLE "crm_leads" ADD COLUMN "capture_channel" "CrmLeadCaptureChannel" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "capture_provider" TEXT,
ADD COLUMN "import_job_id" UUID;

-- CreateTable
CREATE TABLE "crm_import_jobs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" "CrmImportFileType" NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "file_key" TEXT,
    "status" "CrmImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_id" UUID,
    "duplicate_policy" "CrmDuplicatePolicy" NOT NULL DEFAULT 'SKIP',
    "headers" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "flagged_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "queue_job_id" TEXT,
    "validated_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_import_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "validation" "CrmImportRowValidation" NOT NULL DEFAULT 'PENDING',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "duplicate_matches" JSONB,
    "in_file_duplicate_of" INTEGER,
    "outcome" "CrmIngestOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_reason" TEXT,
    "lead_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" UUID,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "crm_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_external_refs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_ingest_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel" "CrmLeadCaptureChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "api_key_id" UUID,
    "webhook_endpoint_id" UUID,
    "idempotency_key" TEXT,
    "external_event_id" TEXT,
    "external_lead_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "CrmIngestEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "outcome" "CrmIngestOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_reason" TEXT,
    "duplicate_matches" JSONB,
    "lead_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_ingest_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_api_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['leads:ingest']::TEXT[],
    "default_source_id" UUID,
    "default_owner_user_id" UUID,
    "duplicate_policy" "CrmDuplicatePolicy" NOT NULL DEFAULT 'UPDATE',
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_webhook_endpoints" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'generic',
    "secret_encrypted" TEXT NOT NULL,
    "field_mapping" JSONB NOT NULL DEFAULT '{}',
    "default_source_id" UUID,
    "default_owner_user_id" UUID,
    "duplicate_policy" "CrmDuplicatePolicy" NOT NULL DEFAULT 'UPDATE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_leads_company_id_capture_channel_idx" ON "crm_leads"("company_id", "capture_channel");
CREATE INDEX "crm_import_jobs_company_id_created_at_idx" ON "crm_import_jobs"("company_id", "created_at");
CREATE INDEX "crm_import_jobs_company_id_created_by_user_id_idx" ON "crm_import_jobs"("company_id", "created_by_user_id");
CREATE INDEX "crm_import_jobs_status_updated_at_idx" ON "crm_import_jobs"("status", "updated_at");
CREATE UNIQUE INDEX "crm_import_rows_job_id_row_number_key" ON "crm_import_rows"("job_id", "row_number");
CREATE INDEX "crm_import_rows_job_id_outcome_idx" ON "crm_import_rows"("job_id", "outcome");
CREATE INDEX "crm_import_rows_job_id_validation_idx" ON "crm_import_rows"("job_id", "validation");
CREATE UNIQUE INDEX "crm_lead_external_refs_company_id_provider_external_id_key" ON "crm_lead_external_refs"("company_id", "provider", "external_id");
CREATE INDEX "crm_lead_external_refs_lead_id_idx" ON "crm_lead_external_refs"("lead_id");
CREATE UNIQUE INDEX "crm_ingest_events_company_id_provider_idempotency_key_key" ON "crm_ingest_events"("company_id", "provider", "idempotency_key");
CREATE INDEX "crm_ingest_events_company_id_received_at_idx" ON "crm_ingest_events"("company_id", "received_at");
CREATE INDEX "crm_ingest_events_company_id_status_idx" ON "crm_ingest_events"("company_id", "status");
CREATE UNIQUE INDEX "crm_api_keys_prefix_key" ON "crm_api_keys"("prefix");
CREATE INDEX "crm_api_keys_company_id_idx" ON "crm_api_keys"("company_id");
CREATE INDEX "crm_webhook_endpoints_company_id_idx" ON "crm_webhook_endpoints"("company_id");

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "crm_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_import_jobs" ADD CONSTRAINT "crm_import_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_import_jobs" ADD CONSTRAINT "crm_import_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_import_jobs" ADD CONSTRAINT "crm_import_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "crm_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_lead_external_refs" ADD CONSTRAINT "crm_lead_external_refs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lead_external_refs" ADD CONSTRAINT "crm_lead_external_refs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_ingest_events" ADD CONSTRAINT "crm_ingest_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_ingest_events" ADD CONSTRAINT "crm_ingest_events_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "crm_api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_ingest_events" ADD CONSTRAINT "crm_ingest_events_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "crm_webhook_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_ingest_events" ADD CONSTRAINT "crm_ingest_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_api_keys" ADD CONSTRAINT "crm_api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_api_keys" ADD CONSTRAINT "crm_api_keys_default_source_id_fkey" FOREIGN KEY ("default_source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_api_keys" ADD CONSTRAINT "crm_api_keys_default_owner_user_id_fkey" FOREIGN KEY ("default_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_api_keys" ADD CONSTRAINT "crm_api_keys_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_default_source_id_fkey" FOREIGN KEY ("default_source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_default_owner_user_id_fkey" FOREIGN KEY ("default_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: companies that already use the CRM get the new system lead source
-- (new companies get it from the defaults in code).
INSERT INTO "crm_lead_sources" ("id", "company_id", "key", "name", "sort_order", "is_system", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), c.company_id, 'trade_portal', 'Trade portal', 125, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "company_id" FROM "crm_lead_sources") c
ON CONFLICT ("company_id", "key") DO NOTHING;

-- Data: CRM lead / opportunity numbers are unique per company, but Phase 02
-- drew them from per-branch sequences, so two branches (or a user without a
-- branch) could produce the same number. Fold every CRM sequence into one
-- company-level sequence (branch NULL) that continues after the highest
-- number already issued — taken from the sequences and from the records
-- themselves — then remove the per-branch rows.
CREATE TEMP TABLE "_crm_seq" AS
SELECT "company_id", "document_type", "fiscal_year", MAX("current_number") AS "n", MAX("prefix") AS "prefix", MAX("padding_length") AS "pad"
FROM "document_sequences"
WHERE "document_type" IN ('CRM_LEAD', 'CRM_OPPORTUNITY')
GROUP BY "company_id", "document_type", "fiscal_year";

UPDATE "_crm_seq" s SET "n" = GREATEST(s."n", COALESCE((
  SELECT MAX(split_part(l."lead_number", '-', 3)::bigint) FROM "crm_leads" l
  WHERE l."company_id" = s."company_id" AND l."lead_number" ~ '^[A-Z]+-[0-9]{4}-[0-9]+$' AND split_part(l."lead_number", '-', 2) = s."fiscal_year"::text
), 0))
WHERE s."document_type" = 'CRM_LEAD';

UPDATE "_crm_seq" s SET "n" = GREATEST(s."n", COALESCE((
  SELECT MAX(split_part(o."opportunity_number", '-', 3)::bigint) FROM "crm_opportunities" o
  WHERE o."company_id" = s."company_id" AND o."opportunity_number" ~ '^[A-Z]+-[0-9]{4}-[0-9]+$' AND split_part(o."opportunity_number", '-', 2) = s."fiscal_year"::text
), 0))
WHERE s."document_type" = 'CRM_OPPORTUNITY';

UPDATE "document_sequences" d SET "current_number" = s."n"
FROM "_crm_seq" s
WHERE d."company_id" = s."company_id" AND d."document_type" = s."document_type" AND d."fiscal_year" = s."fiscal_year" AND d."branch_id" IS NULL;

INSERT INTO "document_sequences" ("id", "company_id", "branch_id", "document_type", "prefix", "fiscal_year", "current_number", "padding_length")
SELECT gen_random_uuid(), s."company_id", NULL, s."document_type", s."prefix", s."fiscal_year", s."n", s."pad"
FROM "_crm_seq" s
WHERE NOT EXISTS (
  SELECT 1 FROM "document_sequences" d
  WHERE d."company_id" = s."company_id" AND d."document_type" = s."document_type" AND d."fiscal_year" = s."fiscal_year" AND d."branch_id" IS NULL
);

DELETE FROM "document_sequences" WHERE "document_type" IN ('CRM_LEAD', 'CRM_OPPORTUNITY') AND "branch_id" IS NOT NULL;

DROP TABLE "_crm_seq";
