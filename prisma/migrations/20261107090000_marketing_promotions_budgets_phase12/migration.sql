-- Sales & Marketing Phase 12: promotions (on the Phase 03 pricing engine) and campaign budgets
-- (on Phase 08 campaigns and existing Finance records).
-- Rollback: prisma/rollback/20261107090000_marketing_promotions_budgets_phase12.down.sql

-- Budget spend categories reuse the campaign lookup lists (values are added at runtime).
ALTER TYPE "MarketingLookupKind" ADD VALUE IF NOT EXISTS 'SPEND_CATEGORY';

-- ── Promotions ──────────────────────────────────────────────────────
CREATE TABLE "marketing_promotions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "owner_user_id" UUID NOT NULL,
    "apply_mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_number" INTEGER NOT NULL DEFAULT 1,
    "approved_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_promotions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_promotions_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
    CONSTRAINT "marketing_promotions_mode_check" CHECK ("apply_mode" IN ('AUTO', 'CODE')),
    CONSTRAINT "marketing_promotions_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
    -- Only a promotion with an approved version can be switched on or paused.
    CONSTRAINT "marketing_promotions_approved_check" CHECK ("status" IN ('DRAFT', 'ARCHIVED') OR "approved_version_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "marketing_promotions_company_id_code_key" ON "marketing_promotions"("company_id", "code");
CREATE UNIQUE INDEX "marketing_promotions_approved_version_id_key" ON "marketing_promotions"("approved_version_id");
CREATE INDEX "marketing_promotions_company_id_status_idx" ON "marketing_promotions"("company_id", "status");

CREATE TABLE "marketing_promotion_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "discount_type" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "stacking" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "category_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "excluded_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "customer_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "price_list_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "sales_channel_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "campaign_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "segment_id" UUID,
    "segment_evaluation_id" UUID,
    "min_quantity" DECIMAL(18,3),
    "min_line_value" DECIMAL(18,2),
    "max_redemptions" INTEGER,
    "max_redemptions_per_customer" INTEGER,
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_promotion_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_promotion_versions_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
    CONSTRAINT "marketing_promotion_versions_type_check" CHECK ("discount_type" IN ('PERCENT', 'AMOUNT_PER_UNIT')),
    CONSTRAINT "marketing_promotion_versions_stacking_check" CHECK ("stacking" IN ('EXCLUSIVE', 'STACKABLE')),
    CONSTRAINT "marketing_promotion_versions_value_check" CHECK ("value" > 0 AND ("discount_type" <> 'PERCENT' OR "value" <= 100)),
    CONSTRAINT "marketing_promotion_versions_dates_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
    CONSTRAINT "marketing_promotion_versions_limits_check" CHECK (("max_redemptions" IS NULL OR "max_redemptions" > 0) AND ("max_redemptions_per_customer" IS NULL OR "max_redemptions_per_customer" > 0) AND ("min_quantity" IS NULL OR "min_quantity" > 0) AND ("min_line_value" IS NULL OR "min_line_value" > 0)),
    CONSTRAINT "marketing_promotion_versions_segment_check" CHECK (("segment_id" IS NULL) = ("segment_evaluation_id" IS NULL)),
    CONSTRAINT "marketing_promotion_versions_decision_check" CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR ("decided_by_user_id" IS NOT NULL AND "decided_by_user_id" <> "created_by_user_id" AND "decided_by_user_id" <> COALESCE("submitted_by_user_id", "created_by_user_id")))
);
CREATE UNIQUE INDEX "marketing_promotion_versions_promotion_id_version_number_key" ON "marketing_promotion_versions"("promotion_id", "version_number");
-- One open (draft / pending) version per promotion.
CREATE UNIQUE INDEX "marketing_promotion_versions_one_open" ON "marketing_promotion_versions"("promotion_id") WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL');

CREATE TABLE "marketing_promotion_redemptions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "promotion_version_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "quotation_revision_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" TEXT NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL,
    "expires_on" DATE NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "sales_order_id" UUID,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    CONSTRAINT "marketing_promotion_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_promotion_redemptions_status_check" CHECK ("status" IN ('RESERVED', 'REDEEMED', 'RELEASED')),
    CONSTRAINT "marketing_promotion_redemptions_amount_check" CHECK ("discount_amount" >= 0),
    CONSTRAINT "marketing_promotion_redemptions_state_check" CHECK (
         ("status" <> 'REDEEMED' OR ("redeemed_at" IS NOT NULL AND "sales_order_id" IS NOT NULL))
     AND ("status" <> 'RELEASED' OR "released_at" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "marketing_promotion_redemptions_promotion_id_quotation_revision_id_key" ON "marketing_promotion_redemptions"("promotion_id", "quotation_revision_id");
CREATE INDEX "marketing_promotion_redemptions_promotion_id_status_idx" ON "marketing_promotion_redemptions"("promotion_id", "status");
CREATE INDEX "marketing_promotion_redemptions_quotation_id_idx" ON "marketing_promotion_redemptions"("quotation_id");
CREATE INDEX "marketing_promotion_redemptions_sales_order_id_idx" ON "marketing_promotion_redemptions"("sales_order_id");

ALTER TABLE "quotation_revisions" ADD COLUMN "promotion_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── Budgets ─────────────────────────────────────────────────────────
CREATE TABLE "marketing_budget_allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "campaign_channel_id" UUID,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_budget_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_budget_allocations_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "marketing_budget_allocations_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED'))
);
CREATE INDEX "marketing_budget_allocations_company_id_campaign_id_idx" ON "marketing_budget_allocations"("company_id", "campaign_id");
CREATE UNIQUE INDEX "marketing_budget_allocations_campaign_name_key" ON "marketing_budget_allocations"("campaign_id", lower("name"));

CREATE TABLE "marketing_budget_alerts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "scope_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "basis" JSONB NOT NULL DEFAULT '{}',
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMP(3),
    CONSTRAINT "marketing_budget_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_budget_alerts_kind_check" CHECK ("kind" IN ('WARN_THRESHOLD', 'OVER_BUDGET', 'OVER_ALLOCATED', 'ENDED_WITH_OPEN_COMMITMENTS')),
    CONSTRAINT "marketing_budget_alerts_status_check" CHECK ("status" IN ('OPEN', 'CLEARED'))
);
-- One open alert per condition: an unchanged condition is never notified twice.
CREATE UNIQUE INDEX "marketing_budget_alerts_one_open" ON "marketing_budget_alerts"("campaign_id", "scope_key", "kind") WHERE "status" = 'OPEN';
CREATE INDEX "marketing_budget_alerts_company_id_status_idx" ON "marketing_budget_alerts"("company_id", "status");

-- Spend links on the existing Finance records (no copies of their amounts).
ALTER TABLE "expenses" ADD COLUMN "budget_allocation_id" UUID;
ALTER TABLE "purchase_orders" ADD COLUMN "campaign_id" UUID, ADD COLUMN "budget_allocation_id" UUID;
ALTER TABLE "purchase_invoices" ADD COLUMN "campaign_id" UUID, ADD COLUMN "budget_allocation_id" UUID;
CREATE INDEX "expenses_budget_allocation_id_idx" ON "expenses"("budget_allocation_id");
CREATE INDEX "purchase_orders_company_id_campaign_id_idx" ON "purchase_orders"("company_id", "campaign_id");
CREATE INDEX "purchase_orders_budget_allocation_id_idx" ON "purchase_orders"("budget_allocation_id");
CREATE INDEX "purchase_invoices_company_id_campaign_id_idx" ON "purchase_invoices"("company_id", "campaign_id");
CREATE INDEX "purchase_invoices_budget_allocation_id_idx" ON "purchase_invoices"("budget_allocation_id");
-- A budget line is only ever set together with a campaign.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_budget_allocation_campaign_check" CHECK ("budget_allocation_id" IS NULL OR "campaign_id" IS NOT NULL);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_allocation_campaign_check" CHECK ("budget_allocation_id" IS NULL OR "campaign_id" IS NOT NULL);
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_budget_allocation_campaign_check" CHECK ("budget_allocation_id" IS NULL OR "campaign_id" IS NOT NULL);

ALTER TABLE "sales_marketing_settings" ADD COLUMN "budget_warn_percent" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "sales_marketing_settings" ADD CONSTRAINT "sales_marketing_settings_budget_warn_check" CHECK ("budget_warn_percent" BETWEEN 50 AND 99);

-- ── Foreign keys ────────────────────────────────────────────────────
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_promotion_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_versions" ADD CONSTRAINT "marketing_promotion_versions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_versions" ADD CONSTRAINT "marketing_promotion_versions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_versions" ADD CONSTRAINT "marketing_promotion_versions_decided_by_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_versions" ADD CONSTRAINT "marketing_promotion_versions_segment_evaluation_id_fkey" FOREIGN KEY ("segment_evaluation_id") REFERENCES "marketing_segment_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_redemptions" ADD CONSTRAINT "marketing_promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing_promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_redemptions" ADD CONSTRAINT "marketing_promotion_redemptions_promotion_version_id_fkey" FOREIGN KEY ("promotion_version_id") REFERENCES "marketing_promotion_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_redemptions" ADD CONSTRAINT "marketing_promotion_redemptions_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_redemptions" ADD CONSTRAINT "marketing_promotion_redemptions_quotation_revision_id_fkey" FOREIGN KEY ("quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_promotion_redemptions" ADD CONSTRAINT "marketing_promotion_redemptions_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_budget_allocations" ADD CONSTRAINT "marketing_budget_allocations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_budget_allocations" ADD CONSTRAINT "marketing_budget_allocations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "marketing_campaign_lookups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_budget_allocations" ADD CONSTRAINT "marketing_budget_allocations_campaign_channel_id_fkey" FOREIGN KEY ("campaign_channel_id") REFERENCES "marketing_campaign_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_budget_allocations" ADD CONSTRAINT "marketing_budget_allocations_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_budget_alerts" ADD CONSTRAINT "marketing_budget_alerts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_budget_allocation_id_fkey" FOREIGN KEY ("budget_allocation_id") REFERENCES "marketing_budget_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity triggers ──────────────────────────────────────────────
-- An approved promotion version never changes its terms (only SUPERSEDED may be set).
CREATE OR REPLACE FUNCTION marketing_promotion_version_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'SUPERSEDED', 'REJECTED') THEN
    IF NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED'
            AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')) THEN
      RAISE EXCEPTION 'A decided promotion version can''t be changed — create a new version' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_promotion_versions_frozen" BEFORE UPDATE ON "marketing_promotion_versions" FOR EACH ROW EXECUTE FUNCTION marketing_promotion_version_frozen();

-- A redemption only moves RESERVED → REDEEMED / RELEASED and REDEEMED → RELEASED.
CREATE OR REPLACE FUNCTION marketing_redemption_forward() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'RELEASED' OR (OLD."status" = 'REDEEMED' AND NEW."status" = 'RESERVED') THEN
    RAISE EXCEPTION 'A redemption can''t go back to %', NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_promotion_redemptions_forward" BEFORE UPDATE ON "marketing_promotion_redemptions" FOR EACH ROW EXECUTE FUNCTION marketing_redemption_forward();

-- ── Permission module "marketing_promotions" ────────────────────────
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_promotions.' || a.action, 'marketing_promotions', a.action || ' access for marketing_promotions', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/create/edit/delete/approve/reject/export; MERCHANDISER view/create/edit; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_promotions'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_promotions.view', 'marketing_promotions.create', 'marketing_promotions.edit', 'marketing_promotions.delete', 'marketing_promotions.approve', 'marketing_promotions.reject', 'marketing_promotions.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_promotions.view', 'marketing_promotions.create', 'marketing_promotions.edit'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_promotions.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
