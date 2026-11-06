-- Sales & Marketing Phase 05 — targets, territories and team performance (2026-11-03).
-- Flat sales territories with rep assignments and customer assignment; a stored
-- sales credit (rep + territory) on Sales Orders, back-filled for existing
-- orders; sales targets with approved revisions; an activity table; the
-- "sales_performance" permission module.
-- Doc: docs/sales-marketing/PHASE_05_PERFORMANCE.md
-- Rollback: prisma/rollback/20261103090000_sales_performance_phase5.down.sql

-- CreateEnum
CREATE TYPE "SalesTargetScope" AS ENUM ('REP', 'TEAM', 'TERRITORY', 'COMPANY');
CREATE TYPE "SalesTargetMetric" AS ENUM ('BOOKED_ORDER_VALUE', 'BOOKED_ORDER_COUNT', 'BOOKED_QUANTITY', 'ACCEPTED_QUOTATION_VALUE', 'ACCEPTED_QUOTATION_COUNT', 'INVOICED_VALUE');
CREATE TYPE "SalesTargetPeriodType" AS ENUM ('MONTH', 'QUARTER', 'YEAR');
CREATE TYPE "SalesTargetRevisionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED');
CREATE TYPE "SalesCreditSource" AS ENUM ('QUOTATION_OWNER', 'CRM_OWNER', 'TERRITORY_PRIMARY', 'CREATOR', 'MANUAL', 'BACKFILL');

-- CreateTable
CREATE TABLE "sales_territories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_territories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_territory_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_territory_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_territory_assignments_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);

CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "scope" "SalesTargetScope" NOT NULL,
    "user_id" UUID,
    "territory_id" UUID,
    "metric" "SalesTargetMetric" NOT NULL,
    "period_type" "SalesTargetPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "name" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" UUID,
    "archive_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_targets_period_check" CHECK ("period_end" >= "period_start"),
    -- REP / TEAM name a user; TERRITORY names a territory; COMPANY names neither.
    CONSTRAINT "sales_targets_subject_check" CHECK (
         ("scope" IN ('REP', 'TEAM') AND "user_id" IS NOT NULL AND "territory_id" IS NULL)
      OR ("scope" = 'TERRITORY' AND "territory_id" IS NOT NULL AND "user_id" IS NULL)
      OR ("scope" = 'COMPANY' AND "user_id" IS NULL AND "territory_id" IS NULL)
    )
);

CREATE TABLE "sales_target_revisions" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "SalesTargetRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "target_value" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_target_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_target_revisions_value_check" CHECK ("target_value" >= 0)
);

CREATE TABLE "sales_performance_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_performance_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "sales_territory_id" UUID;

ALTER TABLE "sales_orders"
    ADD COLUMN "sales_rep_user_id" UUID,
    ADD COLUMN "sales_territory_id" UUID,
    ADD COLUMN "sales_credit_source" "SalesCreditSource",
    ADD COLUMN "sales_credit_changed_at" TIMESTAMP(3),
    ADD COLUMN "sales_credit_changed_by_id" UUID,
    ADD COLUMN "sales_credit_reason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_territories_company_id_code_key" ON "sales_territories"("company_id", "code");
CREATE INDEX "sales_territory_assignments_territory_id_start_date_idx" ON "sales_territory_assignments"("territory_id", "start_date");
CREATE INDEX "sales_territory_assignments_company_id_user_id_idx" ON "sales_territory_assignments"("company_id", "user_id");
CREATE INDEX "sales_targets_company_id_period_start_metric_idx" ON "sales_targets"("company_id", "period_start", "metric");
CREATE UNIQUE INDEX "sales_target_revisions_target_id_revision_number_key" ON "sales_target_revisions"("target_id", "revision_number");
CREATE INDEX "sales_performance_events_entity_type_entity_id_created_at_idx" ON "sales_performance_events"("entity_type", "entity_id", "created_at");
CREATE INDEX "sales_orders_company_id_sales_rep_user_id_order_date_idx" ON "sales_orders"("company_id", "sales_rep_user_id", "order_date");
CREATE INDEX "sales_orders_company_id_sales_territory_id_order_date_idx" ON "sales_orders"("company_id", "sales_territory_id", "order_date");

-- One live target per scope + subject + metric + period (SQL only).
CREATE UNIQUE INDEX "sales_targets_one_live_per_subject_period" ON "sales_targets" (
    "company_id", "scope",
    COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("territory_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "metric", "period_type", "period_start"
) WHERE NOT "is_archived";
-- One open (draft / pending) revision and one approved revision per target.
CREATE UNIQUE INDEX "sales_target_revisions_one_open" ON "sales_target_revisions" ("target_id") WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL');
CREATE UNIQUE INDEX "sales_target_revisions_one_approved" ON "sales_target_revisions" ("target_id") WHERE "status" = 'APPROVED';

-- AddForeignKey
ALTER TABLE "sales_territories" ADD CONSTRAINT "sales_territories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_territories" ADD CONSTRAINT "sales_territories_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_territory_assignments" ADD CONSTRAINT "sales_territory_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_territory_assignments" ADD CONSTRAINT "sales_territory_assignments_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "sales_territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_territory_assignments" ADD CONSTRAINT "sales_territory_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_territory_assignments" ADD CONSTRAINT "sales_territory_assignments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "sales_territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_target_revisions" ADD CONSTRAINT "sales_target_revisions_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "sales_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_target_revisions" ADD CONSTRAINT "sales_target_revisions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_target_revisions" ADD CONSTRAINT "sales_target_revisions_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_target_revisions" ADD CONSTRAINT "sales_target_revisions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_target_revisions" ADD CONSTRAINT "sales_target_revisions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_performance_events" ADD CONSTRAINT "sales_performance_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_performance_events" ADD CONSTRAINT "sales_performance_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_territory_id_fkey" FOREIGN KEY ("sales_territory_id") REFERENCES "sales_territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_rep_user_id_fkey" FOREIGN KEY ("sales_rep_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_territory_id_fkey" FOREIGN KEY ("sales_territory_id") REFERENCES "sales_territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_credit_changed_by_id_fkey" FOREIGN KEY ("sales_credit_changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Back-fill sales credit on existing orders: the converted quotation's owner,
-- else whoever created the order. No territories existed before this phase.
UPDATE "sales_orders" so
SET "sales_rep_user_id" = COALESCE(q."owner_user_id", so."requested_by_user_id"),
    "sales_credit_source" = 'BACKFILL'
FROM "sales_orders" so2
LEFT JOIN "quotation_revisions" qr ON qr."id" = so2."source_quotation_revision_id"
LEFT JOIN "quotations" q ON q."id" = qr."quotation_id"
WHERE so2."id" = so."id" AND so."sales_rep_user_id" IS NULL;

-- Permission module "sales_performance" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_performance.' || a.action, 'sales_performance', a.action || ' access for sales_performance', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything, MANAGEMENT
-- view/view_all/create/edit/approve/reject/export, MERCHANDISER view/export,
-- VIEWER view (VIEWER gets view on every module).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_performance'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_performance.view', 'sales_performance.view_all', 'sales_performance.create', 'sales_performance.edit', 'sales_performance.approve', 'sales_performance.reject', 'sales_performance.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('sales_performance.view', 'sales_performance.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'sales_performance.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
