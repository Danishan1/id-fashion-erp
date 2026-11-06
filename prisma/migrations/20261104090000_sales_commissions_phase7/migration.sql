-- Sales & Marketing Phase 07 — sales channels, commissions and incentives (2026-11-04).
-- Channel master; channel + sales agent on enquiries, quotations and Sales
-- Orders; commission plans with approved versions and assignments; monthly
-- commission statements with lines (one event per payee, never twice);
-- target-attainment incentive plans; the "Sales commission" payment request
-- type; the "sales_commissions" permission module.
-- Doc: docs/sales-marketing/PHASE_07_COMMISSIONS.md
-- Rollback: prisma/rollback/20261104090000_sales_commissions_phase7.down.sql

-- AlterEnum (new value isn't used in this transaction)
ALTER TYPE "PaymentRequestType" ADD VALUE IF NOT EXISTS 'SALES_COMMISSION';

-- CreateEnum
CREATE TYPE "SalesCommissionPayeeType" AS ENUM ('REP', 'AGENT');
CREATE TYPE "SalesCommissionBasis" AS ENUM ('INVOICED', 'COLLECTED');
CREATE TYPE "SalesCommissionMethod" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "SalesCommissionTierMode" AS ENUM ('ALL_UNITS', 'PROGRESSIVE');
CREATE TYPE "SalesCommissionVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'WITHDRAWN');
CREATE TYPE "SalesCommissionStatementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED');
CREATE TYPE "SalesCommissionLineKind" AS ENUM ('EARNING', 'REVERSAL', 'CARRY_FORWARD', 'ADJUSTMENT', 'INCENTIVE');
CREATE TYPE "SalesIncentivePlanStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED');

-- CreateTable
CREATE TABLE "sales_channels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "manager_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_commission_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payee_type" "SalesCommissionPayeeType" NOT NULL,
    "basis" "SalesCommissionBasis" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_commission_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_commission_plan_versions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "SalesCommissionVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "method" "SalesCommissionMethod" NOT NULL,
    "tier_mode" "SalesCommissionTierMode" NOT NULL DEFAULT 'ALL_UNITS',
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "fixed_amount" DECIMAL(18,2),
    "minimum_basis" DECIMAL(18,2),
    "cap_amount" DECIMAL(18,2),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_commission_plan_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_commission_plan_versions_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
    CONSTRAINT "sales_commission_plan_versions_amounts_check" CHECK (
          ("fixed_amount" IS NULL OR "fixed_amount" >= 0)
      AND ("minimum_basis" IS NULL OR "minimum_basis" >= 0)
      AND ("cap_amount" IS NULL OR "cap_amount" >= 0)
      AND ("method" <> 'FIXED' OR "fixed_amount" IS NOT NULL)
    )
);

CREATE TABLE "sales_commission_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "payee_type" "SalesCommissionPayeeType" NOT NULL,
    "user_id" UUID,
    "sales_agent_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_commission_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_commission_assignments_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    CONSTRAINT "sales_commission_assignments_payee_check" CHECK (
         ("payee_type" = 'REP' AND "user_id" IS NOT NULL AND "sales_agent_id" IS NULL)
      OR ("payee_type" = 'AGENT' AND "sales_agent_id" IS NOT NULL AND "user_id" IS NULL)
    )
);

CREATE TABLE "sales_commission_statements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payee_type" "SalesCommissionPayeeType" NOT NULL,
    "user_id" UUID,
    "sales_agent_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "SalesCommissionStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "earned_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reversal_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "incentive_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "carry_forward_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculated_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "payment_request_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_commission_statements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_commission_statements_period_check" CHECK ("period_end" >= "period_start"),
    CONSTRAINT "sales_commission_statements_payee_check" CHECK (
         ("payee_type" = 'REP' AND "user_id" IS NOT NULL AND "sales_agent_id" IS NULL)
      OR ("payee_type" = 'AGENT' AND "sales_agent_id" IS NOT NULL AND "user_id" IS NULL)
    )
);

CREATE TABLE "sales_commission_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "payee_key" TEXT NOT NULL,
    "kind" "SalesCommissionLineKind" NOT NULL,
    "event_key" TEXT NOT NULL,
    "plan_id" UUID,
    "plan_version_id" UUID,
    "incentive_plan_id" UUID,
    "sales_invoice_id" UUID,
    "sales_order_id" UUID,
    "source_type" TEXT,
    "source_id" UUID,
    "event_date" DATE,
    "basis_amount" DECIMAL(18,2),
    "rate" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "reversal_of_line_id" UUID,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_commission_lines_pkey" PRIMARY KEY ("id"),
    -- Reversals and recoveries are negative; earnings and incentives aren't.
    CONSTRAINT "sales_commission_lines_sign_check" CHECK (
         ("kind" IN ('EARNING', 'INCENTIVE') AND "amount" >= 0)
      OR ("kind" IN ('REVERSAL', 'CARRY_FORWARD') AND "amount" <= 0)
      OR "kind" = 'ADJUSTMENT'
    )
);

CREATE TABLE "sales_incentive_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric" "SalesTargetMetric" NOT NULL,
    "period_type" "SalesTargetPeriodType" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "SalesIncentivePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_incentive_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_incentive_plans_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);

-- AlterTable: channel + agent on enquiries, quotations, orders
ALTER TABLE "buyer_enquiries" ADD COLUMN "sales_channel_id" UUID, ADD COLUMN "sales_agent_id" UUID;
ALTER TABLE "quotations" ADD COLUMN "sales_channel_id" UUID, ADD COLUMN "sales_agent_id" UUID;
ALTER TABLE "sales_orders" ADD COLUMN "sales_channel_id" UUID, ADD COLUMN "sales_agent_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_channels_company_id_code_key" ON "sales_channels"("company_id", "code");
CREATE UNIQUE INDEX "sales_commission_plans_company_id_code_key" ON "sales_commission_plans"("company_id", "code");
CREATE UNIQUE INDEX "sales_commission_plan_versions_plan_id_version_number_key" ON "sales_commission_plan_versions"("plan_id", "version_number");
CREATE INDEX "sales_commission_assignments_company_id_payee_type_start_d_idx" ON "sales_commission_assignments"("company_id", "payee_type", "start_date");
CREATE INDEX "sales_commission_assignments_plan_id_idx" ON "sales_commission_assignments"("plan_id");
CREATE UNIQUE INDEX "sales_commission_statements_payment_request_id_key" ON "sales_commission_statements"("payment_request_id");
CREATE INDEX "sales_commission_statements_company_id_period_start_idx" ON "sales_commission_statements"("company_id", "period_start");
CREATE UNIQUE INDEX "sales_commission_lines_company_id_payee_key_event_key_key" ON "sales_commission_lines"("company_id", "payee_key", "event_key");
CREATE INDEX "sales_commission_lines_statement_id_idx" ON "sales_commission_lines"("statement_id");
CREATE UNIQUE INDEX "sales_incentive_plans_company_id_code_key" ON "sales_incentive_plans"("company_id", "code");
CREATE INDEX "sales_orders_company_id_sales_channel_id_idx" ON "sales_orders"("company_id", "sales_channel_id");
-- SQL only: one open (draft / pending) version per plan; one statement per payee and month.
CREATE UNIQUE INDEX "sales_commission_plan_versions_one_open" ON "sales_commission_plan_versions" ("plan_id") WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL');
CREATE UNIQUE INDEX "sales_commission_plan_versions_approved_start" ON "sales_commission_plan_versions" ("plan_id", "effective_from") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "sales_commission_statements_one_per_payee_month" ON "sales_commission_statements" (
    "company_id", "payee_type",
    COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("sales_agent_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "period_start"
);

-- AddForeignKey
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_channel_id_fkey" FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plans" ADD CONSTRAINT "sales_commission_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plans" ADD CONSTRAINT "sales_commission_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plan_versions" ADD CONSTRAINT "sales_commission_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sales_commission_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plan_versions" ADD CONSTRAINT "sales_commission_plan_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plan_versions" ADD CONSTRAINT "sales_commission_plan_versions_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plan_versions" ADD CONSTRAINT "sales_commission_plan_versions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_plan_versions" ADD CONSTRAINT "sales_commission_plan_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_assignments" ADD CONSTRAINT "sales_commission_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_assignments" ADD CONSTRAINT "sales_commission_assignments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sales_commission_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_assignments" ADD CONSTRAINT "sales_commission_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_assignments" ADD CONSTRAINT "sales_commission_assignments_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_assignments" ADD CONSTRAINT "sales_commission_assignments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_calculated_by_user_id_fkey" FOREIGN KEY ("calculated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_statements" ADD CONSTRAINT "sales_commission_statements_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "sales_commission_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sales_commission_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "sales_commission_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_incentive_plan_id_fkey" FOREIGN KEY ("incentive_plan_id") REFERENCES "sales_incentive_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_reversal_of_line_id_fkey" FOREIGN KEY ("reversal_of_line_id") REFERENCES "sales_commission_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_commission_lines" ADD CONSTRAINT "sales_commission_lines_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_incentive_plans" ADD CONSTRAINT "sales_incentive_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_incentive_plans" ADD CONSTRAINT "sales_incentive_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_incentive_plans" ADD CONSTRAINT "sales_incentive_plans_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_incentive_plans" ADD CONSTRAINT "sales_incentive_plans_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_incentive_plans" ADD CONSTRAINT "sales_incentive_plans_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission module "sales_commissions" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_commissions.' || a.action, 'sales_commissions', a.action || ' access for sales_commissions', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/view_all/create/edit/approve/reject/export; MERCHANDISER view/export; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_commissions'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_commissions.view', 'sales_commissions.view_all', 'sales_commissions.create', 'sales_commissions.edit', 'sales_commissions.approve', 'sales_commissions.reject', 'sales_commissions.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('sales_commissions.view', 'sales_commissions.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'sales_commissions.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
