-- Sales & Marketing Release 1 / S3 — approve, issue, revise, PDF, send, accept (2026-10-28).
-- Adds the S3 fields to quotation_revisions, the quotation_events timeline,
-- per-company sales_marketing_settings (approval limits, D2) and the
-- "sales_marketing_settings" permission module.
-- Rollback: prisma/rollback/20261028280000_sales_quotations_s3.down.sql

-- AlterTable
ALTER TABLE "quotation_revisions"
    ADD COLUMN "revision_reason" TEXT,
    ADD COLUMN "previous_revision_id" UUID,
    ADD COLUMN "approval_required" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "approval_reasons" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "submitted_at" TIMESTAMP(3),
    ADD COLUMN "submitted_by_user_id" UUID,
    ADD COLUMN "approved_at" TIMESTAMP(3),
    ADD COLUMN "approved_by_user_id" UUID,
    ADD COLUMN "approval_comment" TEXT,
    ADD COLUMN "issued_at" TIMESTAMP(3),
    ADD COLUMN "issued_by_user_id" UUID,
    ADD COLUMN "document_snapshot" JSONB,
    ADD COLUMN "sent_at" TIMESTAMP(3),
    ADD COLUMN "sent_by_user_id" UUID,
    ADD COLUMN "sent_to" TEXT,
    ADD COLUMN "sent_method" TEXT,
    ADD COLUMN "customer_decision_at" TIMESTAMP(3),
    ADD COLUMN "decision_recorded_at" TIMESTAMP(3),
    ADD COLUMN "decision_recorded_by_id" UUID,
    ADD COLUMN "decision_method" TEXT,
    ADD COLUMN "customer_reference" TEXT,
    ADD COLUMN "decision_comment" TEXT;

-- CreateTable
CREATE TABLE "quotation_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_marketing_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quotation_approval_max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "quotation_approval_max_total" DECIMAL(18,2) NOT NULL DEFAULT 500000,
    "quotation_default_validity_days" INTEGER NOT NULL DEFAULT 30,
    "quotation_default_terms" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_marketing_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_marketing_settings_values_check" CHECK (
      "quotation_approval_max_discount_percent" >= 0 AND "quotation_approval_max_discount_percent" <= 100
      AND "quotation_approval_max_total" >= 0
      AND "quotation_default_validity_days" BETWEEN 1 AND 365)
);

-- CreateIndex
CREATE INDEX "quotation_events_quotation_id_created_at_idx" ON "quotation_events"("quotation_id", "created_at");
CREATE UNIQUE INDEX "sales_marketing_settings_company_id_key" ON "sales_marketing_settings"("company_id");

-- AddForeignKey
ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_marketing_settings" ADD CONSTRAINT "sales_marketing_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Timeline start for quotations created before S3.
INSERT INTO "quotation_events" ("id", "company_id", "quotation_id", "revision_number", "type", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), q."company_id", q."id", 1, 'CREATED', q."created_by_user_id", q."created_at" FROM "quotations" q;
INSERT INTO "quotation_events" ("id", "company_id", "quotation_id", "revision_number", "type", "comment", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), q."company_id", q."id", q."current_revision_number", 'CANCELLED', q."cancellation_reason", q."created_by_user_id", q."cancelled_at"
FROM "quotations" q WHERE q."status" = 'CANCELLED' AND q."cancelled_at" IS NOT NULL;

-- Permission module "sales_marketing_settings" (every catalog action), granted
-- like crm_settings: copy every crm_settings.<action> grant and override.
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_marketing_settings.' || a.action, 'sales_marketing_settings', a.action || ' access for sales_marketing_settings', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", np."id", now()
FROM "role_permissions" rp
JOIN "permissions" op ON op."id" = rp."permission_id" AND op."module" = 'crm_settings'
JOIN "permissions" np ON np."key" = 'sales_marketing_settings' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "user_permission_overrides" ("id", "company_id", "user_id", "permission_id", "effect", "reason", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), o."company_id", o."user_id", np."id", o."effect", o."reason", o."created_by_user_id", now()
FROM "user_permission_overrides" o
JOIN "permissions" op ON op."id" = o."permission_id" AND op."module" = 'crm_settings'
JOIN "permissions" np ON np."key" = 'sales_marketing_settings' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
