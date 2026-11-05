-- Sales & Marketing Phase 09: audience segments (docs/sales-marketing/PHASE_09_SEGMENTS.md).
-- Segments over CRM contacts / companies / leads and ERP customers, immutable
-- definition versions, explicit membership, evaluation runs = membership
-- snapshots, campaign audiences; the "marketing_segments" permission module.

CREATE TYPE "MarketingSegmentSource" AS ENUM ('CONTACT', 'COMPANY', 'LEAD', 'CUSTOMER');
CREATE TYPE "MarketingSegmentType" AS ENUM ('DYNAMIC', 'STATIC');
CREATE TYPE "MarketingSegmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "MarketingSegmentRefresh" AS ENUM ('MANUAL', 'NIGHTLY');
CREATE TYPE "MarketingSegmentMemberKind" AS ENUM ('INCLUDED', 'EXCLUDED');
CREATE TYPE "MarketingSegmentEvaluationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED');
CREATE TYPE "MarketingSegmentEntryOutcome" AS ENUM ('INCLUDED', 'EXCLUDED', 'INELIGIBLE');
CREATE TYPE "MarketingCampaignAudienceRole" AS ENUM ('INCLUDE', 'EXCLUDE');

CREATE TABLE "marketing_segments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purpose" TEXT,
    "source_type" "MarketingSegmentSource" NOT NULL,
    "segment_type" "MarketingSegmentType" NOT NULL,
    "status" "MarketingSegmentStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_user_id" UUID NOT NULL,
    "refresh_schedule" "MarketingSegmentRefresh" NOT NULL DEFAULT 'MANUAL',
    "current_version_number" INTEGER NOT NULL DEFAULT 1,
    "last_evaluation_id" UUID,
    "last_evaluated_at" TIMESTAMP(3),
    "last_evaluation_status" "MarketingSegmentEvaluationStatus",
    "last_error" TEXT,
    "member_count" INTEGER,
    "idempotency_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_segments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_segments_company_id_code_key" ON "marketing_segments"("company_id", "code");
CREATE UNIQUE INDEX "marketing_segments_company_id_idempotency_key_key" ON "marketing_segments"("company_id", "idempotency_key");
CREATE INDEX "marketing_segments_company_id_status_idx" ON "marketing_segments"("company_id", "status");
CREATE INDEX "marketing_segments_company_id_owner_user_id_idx" ON "marketing_segments"("company_id", "owner_user_id");
ALTER TABLE "marketing_segments" ADD CONSTRAINT "marketing_segments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_segments" ADD CONSTRAINT "marketing_segments_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_segments" ADD CONSTRAINT "marketing_segments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_segment_versions" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "exclusion_criteria" JSONB,
    "eligibility_channel" TEXT,
    "definition_hash" TEXT NOT NULL,
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_segment_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_segment_versions_segment_id_version_number_key" ON "marketing_segment_versions"("segment_id", "version_number");
ALTER TABLE "marketing_segment_versions" ADD CONSTRAINT "marketing_segment_versions_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "marketing_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Versions are history: never changed once written.
CREATE OR REPLACE FUNCTION marketing_segment_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'marketing_segment_versions rows are immutable'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER marketing_segment_versions_no_update BEFORE UPDATE ON "marketing_segment_versions" FOR EACH ROW EXECUTE FUNCTION marketing_segment_versions_guard();

CREATE TABLE "marketing_segment_members" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "kind" "MarketingSegmentMemberKind" NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "added_by_user_id" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by_user_id" UUID,
    CONSTRAINT "marketing_segment_members_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketing_segment_members_segment_id_kind_removed_at_idx" ON "marketing_segment_members"("segment_id", "kind", "removed_at");
CREATE INDEX "marketing_segment_members_segment_id_record_id_idx" ON "marketing_segment_members"("segment_id", "record_id");
-- One live membership row per record per segment (not in schema.prisma: partial index).
CREATE UNIQUE INDEX "marketing_segment_members_one_live" ON "marketing_segment_members"("segment_id", "record_id") WHERE "removed_at" IS NULL;
ALTER TABLE "marketing_segment_members" ADD CONSTRAINT "marketing_segment_members_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "marketing_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "marketing_segment_evaluations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "MarketingSegmentEvaluationStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "run_as_user_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "matched_count" INTEGER,
    "excluded_count" INTEGER,
    "ineligible_count" INTEGER,
    "member_count" INTEGER,
    "is_kept" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "entries_purged_at" TIMESTAMP(3),
    "error" TEXT,
    "idempotency_key" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "marketing_segment_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_segment_evaluations_segment_id_idempotency_key_key" ON "marketing_segment_evaluations"("segment_id", "idempotency_key");
CREATE INDEX "marketing_segment_evaluations_segment_id_status_finished_at_idx" ON "marketing_segment_evaluations"("segment_id", "status", "finished_at");
CREATE INDEX "marketing_segment_evaluations_company_id_status_idx" ON "marketing_segment_evaluations"("company_id", "status");
-- At most one queued / running evaluation per segment (not in schema.prisma).
CREATE UNIQUE INDEX "marketing_segment_evaluations_one_active" ON "marketing_segment_evaluations"("segment_id") WHERE "status" IN ('QUEUED', 'RUNNING');
ALTER TABLE "marketing_segment_evaluations" ADD CONSTRAINT "marketing_segment_evaluations_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "marketing_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "marketing_segment_snapshot_entries" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "outcome" "MarketingSegmentEntryOutcome" NOT NULL,
    "origin" TEXT NOT NULL,
    "reason" TEXT,
    CONSTRAINT "marketing_segment_snapshot_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_segment_snapshot_entries_evaluation_id_record_id_key" ON "marketing_segment_snapshot_entries"("evaluation_id", "record_id");
CREATE INDEX "marketing_segment_snapshot_entries_evaluation_id_outcome_idx" ON "marketing_segment_snapshot_entries"("evaluation_id", "outcome");
ALTER TABLE "marketing_segment_snapshot_entries" ADD CONSTRAINT "marketing_segment_snapshot_entries_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "marketing_segment_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "marketing_campaign_audiences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "role" "MarketingCampaignAudienceRole" NOT NULL,
    "pinned_evaluation_id" UUID,
    "added_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaign_audiences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_campaign_audiences_campaign_id_segment_id_key" ON "marketing_campaign_audiences"("campaign_id", "segment_id");
CREATE INDEX "marketing_campaign_audiences_segment_id_idx" ON "marketing_campaign_audiences"("segment_id");
ALTER TABLE "marketing_campaign_audiences" ADD CONSTRAINT "marketing_campaign_audiences_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_audiences" ADD CONSTRAINT "marketing_campaign_audiences_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "marketing_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_audiences" ADD CONSTRAINT "marketing_campaign_audiences_pinned_evaluation_id_fkey" FOREIGN KEY ("pinned_evaluation_id") REFERENCES "marketing_segment_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission module "marketing_segments" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_segments.' || a.action, 'marketing_segments', a.action || ' access for marketing_segments', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/view_all/create/edit/delete/export; MERCHANDISER view/create/edit/export; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_segments'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_segments.view', 'marketing_segments.view_all', 'marketing_segments.create', 'marketing_segments.edit', 'marketing_segments.delete', 'marketing_segments.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_segments.view', 'marketing_segments.create', 'marketing_segments.edit', 'marketing_segments.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_segments.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
