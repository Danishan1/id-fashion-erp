-- Sales & Marketing Phase 11: content library (assets, reviews, campaign content).
-- Rollback: prisma/rollback/20261106120000_marketing_content_phase11.down.sql

-- ── Assets ──────────────────────────────────────────────────────────
CREATE TABLE "marketing_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "asset_type" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alt_text" TEXT,
    "usage_notes" TEXT,
    "expires_on" DATE,
    "owner_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "current_version_id" UUID,
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "approved_version_id" UUID,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_assets_type_check" CHECK ("asset_type" IN ('IMAGE', 'LOGO', 'DOCUMENT', 'VIDEO')),
    CONSTRAINT "marketing_assets_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT "marketing_assets_archived_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "marketing_assets_company_id_code_key" ON "marketing_assets"("company_id", "code");
CREATE UNIQUE INDEX "marketing_assets_current_version_id_key" ON "marketing_assets"("current_version_id");
CREATE UNIQUE INDEX "marketing_assets_approved_version_id_key" ON "marketing_assets"("approved_version_id");
CREATE INDEX "marketing_assets_company_id_status_asset_type_idx" ON "marketing_assets"("company_id", "status", "asset_type");
CREATE INDEX "marketing_assets_company_id_owner_user_id_idx" ON "marketing_assets"("company_id", "owner_user_id");
CREATE INDEX "marketing_assets_tags_idx" ON "marketing_assets" USING GIN ("tags");

CREATE TABLE "marketing_asset_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "scan_status" TEXT NOT NULL DEFAULT 'NOT_SCANNED',
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_asset_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_asset_versions_size_check" CHECK ("file_size_bytes" > 0),
    CONSTRAINT "marketing_asset_versions_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "marketing_asset_versions_scan_check" CHECK ("scan_status" IN ('NOT_SCANNED', 'CLEAN', 'INFECTED', 'FAILED'))
);
CREATE UNIQUE INDEX "marketing_asset_versions_asset_id_version_number_key" ON "marketing_asset_versions"("asset_id", "version_number");
CREATE UNIQUE INDEX "marketing_asset_versions_storage_key_key" ON "marketing_asset_versions"("storage_key");
CREATE INDEX "marketing_asset_versions_company_id_sha256_idx" ON "marketing_asset_versions"("company_id", "sha256");

-- ── Reviews ─────────────────────────────────────────────────────────
CREATE TABLE "marketing_content_reviews" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_content_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_content_reviews_subject_check" CHECK ("subject_type" IN ('ASSET_VERSION', 'TEMPLATE_VERSION', 'CONTENT_VERSION')),
    CONSTRAINT "marketing_content_reviews_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN')),
    -- A decision is by someone other than the author, and is recorded with who / when.
    CONSTRAINT "marketing_content_reviews_decision_check" CHECK (
         ("status" IN ('PENDING', 'WITHDRAWN')) OR ("decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL AND "decided_by_user_id" <> "author_user_id")
    )
);
CREATE UNIQUE INDEX "marketing_content_reviews_subject_type_subject_id_key" ON "marketing_content_reviews"("subject_type", "subject_id");
CREATE INDEX "marketing_content_reviews_company_id_status_subject_type_idx" ON "marketing_content_reviews"("company_id", "status", "subject_type");

CREATE TABLE "marketing_content_review_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_content_review_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_content_review_events_action_check" CHECK ("action" IN ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN'))
);
CREATE INDEX "marketing_content_review_events_review_id_created_at_idx" ON "marketing_content_review_events"("review_id", "created_at");

-- ── Campaign content ────────────────────────────────────────────────
CREATE TABLE "marketing_campaign_contents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "source_template_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "current_version_id" UUID,
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "approved_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaign_contents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_campaign_contents_channel_check" CHECK ("channel_type" IN ('EMAIL', 'SMS', 'WHATSAPP')),
    CONSTRAINT "marketing_campaign_contents_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT "marketing_campaign_contents_locale_check" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);
CREATE UNIQUE INDEX "marketing_campaign_contents_current_version_id_key" ON "marketing_campaign_contents"("current_version_id");
CREATE UNIQUE INDEX "marketing_campaign_contents_approved_version_id_key" ON "marketing_campaign_contents"("approved_version_id");
CREATE INDEX "marketing_campaign_contents_company_id_campaign_id_status_idx" ON "marketing_campaign_contents"("company_id", "campaign_id", "status");

CREATE TABLE "marketing_campaign_content_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "source_template_version_id" UUID NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_campaign_content_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_campaign_content_versions_content_id_version_number_key" ON "marketing_campaign_content_versions"("content_id", "version_number");

CREATE TABLE "marketing_content_version_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "marketing_content_version_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_content_version_assets_content_version_id_asset_version_id_key" ON "marketing_content_version_assets"("content_version_id", "asset_version_id");
CREATE INDEX "marketing_content_version_assets_asset_version_id_idx" ON "marketing_content_version_assets"("asset_version_id");

-- ── Phase 10 tables: content source on channels, frozen content on runs ──
ALTER TABLE "marketing_campaign_channels" ADD COLUMN "content_id" UUID;
DROP INDEX "marketing_campaign_channels_campaign_id_connection_id_template_id_key";
CREATE UNIQUE INDEX "marketing_campaign_channels_template_key" ON "marketing_campaign_channels"("campaign_id", "connection_id", "template_id") WHERE "content_id" IS NULL;
CREATE UNIQUE INDEX "marketing_campaign_channels_content_key" ON "marketing_campaign_channels"("campaign_id", "connection_id", "content_id") WHERE "content_id" IS NOT NULL;
ALTER TABLE "marketing_delivery_runs" ADD COLUMN "content_version_id" UUID, ADD COLUMN "locale" TEXT;

-- ── Foreign keys ────────────────────────────────────────────────────
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "marketing_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_asset_versions" ADD CONSTRAINT "marketing_asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketing_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_asset_versions" ADD CONSTRAINT "marketing_asset_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_reviews" ADD CONSTRAINT "marketing_content_reviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_reviews" ADD CONSTRAINT "marketing_content_reviews_submitted_by_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_reviews" ADD CONSTRAINT "marketing_content_reviews_decided_by_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_review_events" ADD CONSTRAINT "marketing_content_review_events_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "marketing_content_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_content_review_events" ADD CONSTRAINT "marketing_content_review_events_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "crm_message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_contents" ADD CONSTRAINT "marketing_campaign_contents_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_content_versions" ADD CONSTRAINT "marketing_campaign_content_versions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "marketing_campaign_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_content_versions" ADD CONSTRAINT "marketing_campaign_content_versions_source_template_version_id_fkey" FOREIGN KEY ("source_template_version_id") REFERENCES "crm_message_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_content_versions" ADD CONSTRAINT "marketing_campaign_content_versions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_version_assets" ADD CONSTRAINT "marketing_content_version_assets_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_content_version_assets" ADD CONSTRAINT "marketing_content_version_assets_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "marketing_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_channels" ADD CONSTRAINT "marketing_campaign_channels_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "marketing_campaign_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "marketing_campaign_content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Immutable versions ──────────────────────────────────────────────
-- An asset file version, a campaign content version and its pinned assets
-- never change once written: replacing content = a new version.
CREATE OR REPLACE FUNCTION marketing_content_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable — create a new version instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_asset_versions_immutable" BEFORE UPDATE OR DELETE ON "marketing_asset_versions" FOR EACH ROW EXECUTE FUNCTION marketing_content_immutable();
CREATE TRIGGER "marketing_campaign_content_versions_immutable" BEFORE UPDATE OR DELETE ON "marketing_campaign_content_versions" FOR EACH ROW EXECUTE FUNCTION marketing_content_immutable();
CREATE TRIGGER "marketing_content_version_assets_immutable" BEFORE UPDATE OR DELETE ON "marketing_content_version_assets" FOR EACH ROW EXECUTE FUNCTION marketing_content_immutable();

-- An approved review is final (its version is what campaigns rely on).
CREATE OR REPLACE FUNCTION marketing_review_final() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'A decided review can''t change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_content_reviews_final" BEFORE UPDATE ON "marketing_content_reviews" FOR EACH ROW EXECUTE FUNCTION marketing_review_final();

-- ── Permission module "marketing_content" ───────────────────────────
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_content.' || a.action, 'marketing_content', a.action || ' access for marketing_content', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/create/edit/delete/approve/reject/export; MERCHANDISER view/create/edit; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_content'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_content.view', 'marketing_content.create', 'marketing_content.edit', 'marketing_content.delete', 'marketing_content.approve', 'marketing_content.reject', 'marketing_content.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_content.view', 'marketing_content.create', 'marketing_content.edit'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_content.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
