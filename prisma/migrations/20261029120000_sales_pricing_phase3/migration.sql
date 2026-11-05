-- Sales & Marketing Phase 03 — pricing, price lists and discount rules (2026-10-29).
-- Price lists (Default / Customer) with numbered, approved, effective-dated
-- versions and all-units quantity-break entries; discount rules; a pricing
-- history table; price source / list price / rule discount / snapshot on
-- quotation lines; a rule-discount cap in Sales & Marketing settings; the
-- "sales_pricing" permission module and sales_quotations.override grants.
-- Doc: docs/sales-marketing/PHASE_03_PRICING.md
-- Rollback: prisma/rollback/20261029120000_sales_pricing_phase3.down.sql

-- CreateEnum
CREATE TYPE "QuotationPriceSource" AS ENUM ('PRICE_LIST', 'MANUAL', 'OVERRIDE');
CREATE TYPE "PriceListKind" AS ENUM ('DEFAULT', 'CUSTOMER');
CREATE TYPE "PriceListVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'WITHDRAWN');
CREATE TYPE "DiscountRuleStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE');
CREATE TYPE "DiscountRuleType" AS ENUM ('PERCENT', 'AMOUNT_PER_UNIT');
CREATE TYPE "DiscountStacking" AS ENUM ('EXCLUSIVE', 'STACKABLE');

-- AlterTable: quotation lines (existing lines are hand-priced = MANUAL)
ALTER TABLE "quotation_lines"
    ADD COLUMN "price_source" "QuotationPriceSource" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "list_unit_price" DECIMAL(18,2),
    ADD COLUMN "rule_discount_amount" DECIMAL(18,2),
    ADD COLUMN "calculated_unit_price" DECIMAL(18,2),
    ADD COLUMN "price_override_reason" TEXT,
    ADD COLUMN "pricing" JSONB;

-- AlterTable: settings
ALTER TABLE "sales_marketing_settings"
    ADD COLUMN "pricing_max_rule_discount_percent" DECIMAL(5,2),
    ADD CONSTRAINT "sales_marketing_settings_pricing_cap_check" CHECK ("pricing_max_rule_discount_percent" IS NULL OR ("pricing_max_rule_discount_percent" >= 0 AND "pricing_max_rule_discount_percent" <= 100));

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "PriceListKind" NOT NULL,
    "customer_id" UUID,
    "currency_code" CHAR(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id"),
    -- A customer list names its customer; a default list doesn't.
    CONSTRAINT "price_lists_kind_customer_check" CHECK (("kind" = 'CUSTOMER') = ("customer_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "price_list_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "PriceListVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approval_comment" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_list_versions_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);

-- CreateTable
CREATE TABLE "price_list_entries" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "uom_id" UUID NOT NULL,
    "min_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_list_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_list_entries_values_check" CHECK ("min_quantity" >= 0 AND "unit_price" >= 0)
);

-- CreateTable
CREATE TABLE "discount_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DiscountRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "discount_type" "DiscountRuleType" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "stacking" "DiscountStacking" NOT NULL DEFAULT 'EXCLUSIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "product_id" UUID,
    "category_id" UUID,
    "customer_id" UUID,
    "price_list_id" UUID,
    "min_quantity" DECIMAL(18,3),
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approval_comment" TEXT,
    "deactivated_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discount_rules_values_check" CHECK (
        "value" > 0
        AND ("discount_type" <> 'PERCENT' OR "value" <= 100)
        AND ("min_quantity" IS NULL OR "min_quantity" >= 0)
        AND ("valid_to" IS NULL OR "valid_to" >= "valid_from")
    )
);

-- CreateTable
CREATE TABLE "pricing_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "version_number" INTEGER,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_company_id_code_key" ON "price_lists"("company_id", "code");
CREATE INDEX "price_lists_company_id_kind_is_active_idx" ON "price_lists"("company_id", "kind", "is_active");
CREATE INDEX "price_lists_customer_id_idx" ON "price_lists"("customer_id");
-- Two active lists of the same kind (and customer) can't share a priority.
CREATE UNIQUE INDEX "price_lists_active_priority_key" ON "price_lists"("company_id", "kind", COALESCE("customer_id", '00000000-0000-0000-0000-000000000000'::uuid), "priority") WHERE "is_active";
CREATE UNIQUE INDEX "price_list_versions_price_list_id_version_number_key" ON "price_list_versions"("price_list_id", "version_number");
CREATE INDEX "price_list_versions_company_id_status_idx" ON "price_list_versions"("company_id", "status");
-- One open (draft / pending) version per list; one approved version per start date.
CREATE UNIQUE INDEX "price_list_versions_one_open_key" ON "price_list_versions"("price_list_id") WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL');
CREATE UNIQUE INDEX "price_list_versions_approved_start_key" ON "price_list_versions"("price_list_id", "effective_from") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "price_list_entries_version_product_uom_min_key" ON "price_list_entries"("version_id", "product_id", "uom_id", "min_quantity");
CREATE INDEX "price_list_entries_product_id_idx" ON "price_list_entries"("product_id");
CREATE UNIQUE INDEX "discount_rules_company_id_code_key" ON "discount_rules"("company_id", "code");
CREATE INDEX "discount_rules_company_id_status_idx" ON "discount_rules"("company_id", "status");
CREATE INDEX "pricing_events_entity_type_entity_id_created_at_idx" ON "pricing_events"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_list_versions" ADD CONSTRAINT "price_list_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission module "sales_pricing" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_pricing.' || a.action, 'sales_pricing', a.action || ' access for sales_pricing', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything, MANAGEMENT
-- view/approve/reject/export, MERCHANDISER view/create/edit/export.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_pricing'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_pricing.view', 'sales_pricing.approve', 'sales_pricing.reject', 'sales_pricing.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('sales_pricing.view', 'sales_pricing.create', 'sales_pricing.edit', 'sales_pricing.export'))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Price overrides on quotation lines.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."key" = 'sales_quotations.override'
WHERE r."is_system_role" AND r."name" IN ('MANAGEMENT', 'MERCHANDISER')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
