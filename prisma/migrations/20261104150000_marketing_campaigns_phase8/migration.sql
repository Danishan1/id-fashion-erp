-- Sales & Marketing Phase 08 — marketing foundation and campaigns (2026-11-04).
-- Campaign types / objectives lists; campaigns with numbered plan revisions
-- (approval, re-approval of dates and budget) and success metrics; optional
-- campaign on CRM leads, enquiries, quotations, Sales Orders and Expenses;
-- CRM activities on a campaign (CrmEntityType CAMPAIGN); the setting
-- "campaign approval required"; the "marketing_campaigns" permission module.
-- Doc: docs/sales-marketing/PHASE_08_CAMPAIGNS.md
-- Rollback: prisma/rollback/20261104150000_marketing_campaigns_phase8.down.sql

-- AlterEnum (new value isn't used in this transaction)
ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'CAMPAIGN';

CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MarketingCampaignPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE "MarketingLookupKind" AS ENUM ('TYPE', 'OBJECTIVE');
CREATE TYPE "MarketingRevisionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "MarketingMetricSource" AS ENUM ('SYSTEM', 'MANUAL');

CREATE TABLE "marketing_campaign_lookups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "MarketingLookupKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaign_lookups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "department_id" UUID,
    "sales_channel_id" UUID,
    "parent_campaign_id" UUID,
    "priority" "MarketingCampaignPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "planned_start_date" DATE NOT NULL,
    "planned_end_date" DATE NOT NULL,
    "actual_start_date" DATE,
    "actual_end_date" DATE,
    "planned_budget" DECIMAL(18,2),
    "budget_notes" TEXT,
    "currency_code" CHAR(3) NOT NULL,
    "approved_revision_number" INTEGER,
    "status_reason" TEXT,
    "idempotency_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_campaigns_planned_dates_check" CHECK ("planned_end_date" >= "planned_start_date"),
    CONSTRAINT "marketing_campaigns_actual_dates_check" CHECK ("actual_end_date" IS NULL OR ("actual_start_date" IS NOT NULL AND "actual_end_date" >= "actual_start_date")),
    CONSTRAINT "marketing_campaigns_budget_check" CHECK ("planned_budget" IS NULL OR "planned_budget" >= 0),
    CONSTRAINT "marketing_campaigns_not_own_parent_check" CHECK ("parent_campaign_id" IS NULL OR "parent_campaign_id" <> "id"),
    -- Running / finished campaigns have a start; completed ones an end.
    CONSTRAINT "marketing_campaigns_actual_status_check" CHECK (
         ("status" NOT IN ('ACTIVE', 'PAUSED', 'COMPLETED') OR "actual_start_date" IS NOT NULL)
     AND ("status" <> 'COMPLETED' OR "actual_end_date" IS NOT NULL)
    )
);

CREATE TABLE "marketing_campaign_revisions" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "MarketingRevisionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "planned_start_date" DATE NOT NULL,
    "planned_end_date" DATE NOT NULL,
    "planned_budget" DECIMAL(18,2),
    "budget_notes" TEXT,
    "reason" TEXT,
    "auto_approved" BOOLEAN NOT NULL DEFAULT false,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    CONSTRAINT "marketing_campaign_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_campaign_revisions_dates_check" CHECK ("planned_end_date" >= "planned_start_date"),
    CONSTRAINT "marketing_campaign_revisions_budget_check" CHECK ("planned_budget" IS NULL OR "planned_budget" >= 0)
);

CREATE TABLE "marketing_campaign_metrics" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "source" "MarketingMetricSource" NOT NULL,
    "system_key" TEXT,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "target_value" DECIMAL(18,2),
    "manual_actual" DECIMAL(18,2),
    "manual_as_of" DATE,
    "manual_updated_by_user_id" UUID,
    "manual_updated_at" TIMESTAMP(3),
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaign_metrics_pkey" PRIMARY KEY ("id"),
    -- System metrics are measured, never typed in; manual ones have no system key.
    CONSTRAINT "marketing_campaign_metrics_source_check" CHECK (
         ("source" = 'SYSTEM' AND "system_key" IS NOT NULL AND "manual_actual" IS NULL)
      OR ("source" = 'MANUAL' AND "system_key" IS NULL)
    ),
    CONSTRAINT "marketing_campaign_metrics_target_check" CHECK ("target_value" IS NULL OR "target_value" >= 0)
);

CREATE UNIQUE INDEX "marketing_campaign_lookups_company_id_kind_code_key" ON "marketing_campaign_lookups"("company_id", "kind", "code");
CREATE UNIQUE INDEX "marketing_campaigns_company_id_code_key" ON "marketing_campaigns"("company_id", "code");
CREATE UNIQUE INDEX "marketing_campaigns_company_id_idempotency_key_key" ON "marketing_campaigns"("company_id", "idempotency_key");
CREATE INDEX "marketing_campaigns_company_id_status_planned_start_date_idx" ON "marketing_campaigns"("company_id", "status", "planned_start_date");
CREATE INDEX "marketing_campaigns_company_id_owner_user_id_idx" ON "marketing_campaigns"("company_id", "owner_user_id");
CREATE UNIQUE INDEX "marketing_campaign_revisions_campaign_id_revision_number_key" ON "marketing_campaign_revisions"("campaign_id", "revision_number");
-- One open (pending) revision per campaign.
CREATE UNIQUE INDEX "marketing_campaign_revisions_one_pending" ON "marketing_campaign_revisions"("campaign_id") WHERE "status" = 'PENDING_APPROVAL';
CREATE UNIQUE INDEX "marketing_campaign_metrics_one_system_key" ON "marketing_campaign_metrics"("campaign_id", "system_key") WHERE "system_key" IS NOT NULL;

ALTER TABLE "marketing_campaign_lookups" ADD CONSTRAINT "marketing_campaign_lookups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "marketing_campaign_lookups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "marketing_campaign_lookups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_parent_campaign_id_fkey" FOREIGN KEY ("parent_campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_revisions" ADD CONSTRAINT "marketing_campaign_revisions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_revisions" ADD CONSTRAINT "marketing_campaign_revisions_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_revisions" ADD CONSTRAINT "marketing_campaign_revisions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_metrics" ADD CONSTRAINT "marketing_campaign_metrics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_metrics" ADD CONSTRAINT "marketing_campaign_metrics_manual_updated_by_user_id_fkey" FOREIGN KEY ("manual_updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Optional campaign on existing records (nullable; existing rows untouched).
ALTER TABLE "crm_leads" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "buyer_enquiries" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "quotations" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "sales_orders" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "campaign_id" UUID;
CREATE INDEX "crm_leads_company_id_campaign_id_idx" ON "crm_leads"("company_id", "campaign_id");
CREATE INDEX "buyer_enquiries_company_id_campaign_id_idx" ON "buyer_enquiries"("company_id", "campaign_id");
CREATE INDEX "quotations_company_id_campaign_id_idx" ON "quotations"("company_id", "campaign_id");
CREATE INDEX "sales_orders_company_id_campaign_id_idx" ON "sales_orders"("company_id", "campaign_id");
CREATE INDEX "expenses_company_id_campaign_id_idx" ON "expenses"("company_id", "campaign_id");
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_marketing_settings" ADD COLUMN "campaign_approval_required" BOOLEAN NOT NULL DEFAULT true;

-- Permission module "marketing_campaigns" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_campaigns.' || a.action, 'marketing_campaigns', a.action || ' access for marketing_campaigns', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/view_all/create/edit/approve/reject/cancel/export; MERCHANDISER view/create/edit/export; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_campaigns'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_campaigns.view', 'marketing_campaigns.view_all', 'marketing_campaigns.create', 'marketing_campaigns.edit', 'marketing_campaigns.approve', 'marketing_campaigns.reject', 'marketing_campaigns.cancel', 'marketing_campaigns.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_campaigns.view', 'marketing_campaigns.create', 'marketing_campaigns.edit', 'marketing_campaigns.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_campaigns.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
