-- Sales & Marketing Phase 17: Advanced Reporting & BI.
-- Rollback: prisma/rollback/20261112090000_sm_analytics_phase17.down.sql
-- Saved reports (governed definitions, never SQL) + version history, a run
-- log (usage/performance only, no result data) and per-recipient deliveries.

CREATE TABLE "sm_analytics_reports" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "definition" JSONB NOT NULL,
  "definition_version" INTEGER NOT NULL DEFAULT 1,
  "sharing" TEXT NOT NULL DEFAULT 'PRIVATE',
  "shared_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
  "recipient_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
  "delivery_format" TEXT NOT NULL DEFAULT 'XLSX',
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sm_analytics_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_analytics_reports_sharing_check" CHECK ("sharing" IN ('PRIVATE', 'USERS', 'COMPANY')),
  CONSTRAINT "sm_analytics_reports_format_check" CHECK ("delivery_format" IN ('CSV', 'XLSX'))
);
CREATE INDEX "sm_analytics_reports_company_id_owner_user_id_idx" ON "sm_analytics_reports"("company_id", "owner_user_id");
CREATE INDEX "sm_analytics_reports_company_id_sharing_idx" ON "sm_analytics_reports"("company_id", "sharing");

CREATE TABLE "sm_analytics_report_versions" (
  "id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "changed_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sm_analytics_report_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sm_analytics_report_versions_report_id_version_key" ON "sm_analytics_report_versions"("report_id", "version");
ALTER TABLE "sm_analytics_report_versions" ADD CONSTRAINT "sm_analytics_report_versions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "sm_analytics_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sm_analytics_runs" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "report_id" UUID,
  "source" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "slow" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sm_analytics_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sm_analytics_runs_company_id_created_at_idx" ON "sm_analytics_runs"("company_id", "created_at");
CREATE INDEX "sm_analytics_runs_company_id_dataset_created_at_idx" ON "sm_analytics_runs"("company_id", "dataset", "created_at");

CREATE TABLE "sm_analytics_deliveries" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "run_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "storage_key" TEXT,
  "file_name" TEXT,
  "mime_type" TEXT,
  "file_size_bytes" INTEGER,
  "row_count" INTEGER,
  "expires_at" TIMESTAMP(3),
  "downloaded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sm_analytics_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_analytics_deliveries_status_check" CHECK ("status" IN ('DELIVERED', 'SKIPPED', 'FAILED'))
);
CREATE UNIQUE INDEX "sm_analytics_deliveries_run_key_recipient_user_id_key" ON "sm_analytics_deliveries"("run_key", "recipient_user_id");
CREATE INDEX "sm_analytics_deliveries_recipient_user_id_created_at_idx" ON "sm_analytics_deliveries"("recipient_user_id", "created_at");
CREATE INDEX "sm_analytics_deliveries_report_id_created_at_idx" ON "sm_analytics_deliveries"("report_id", "created_at");
CREATE INDEX "sm_analytics_deliveries_expires_at_idx" ON "sm_analytics_deliveries"("expires_at");
ALTER TABLE "sm_analytics_deliveries" ADD CONSTRAINT "sm_analytics_deliveries_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "sm_analytics_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions (same roles as src/config/rbac.ts: SUPER_ADMIN all; MANAGEMENT
-- view/create/edit/export; MERCHANDISER view/create/export; VIEWER view).
WITH actions(action) AS (VALUES ('view'), ('create'), ('edit'), ('export'))
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_analytics.' || a.action, 'sales_analytics', a.action || ' access for sales_analytics', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_analytics'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_analytics.view', 'sales_analytics.create', 'sales_analytics.edit', 'sales_analytics.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('sales_analytics.view', 'sales_analytics.create', 'sales_analytics.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'sales_analytics.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
