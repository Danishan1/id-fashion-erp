-- Rollback of 20261107090000_marketing_promotions_budgets_phase12.
-- The SPEND_CATEGORY enum value can't be dropped by Postgres; spend-category lookup rows are deleted.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'marketing_promotions');
DELETE FROM "permissions" WHERE "module" = 'marketing_promotions';
ALTER TABLE "sales_marketing_settings" DROP CONSTRAINT IF EXISTS "sales_marketing_settings_budget_warn_check", DROP COLUMN IF EXISTS "budget_warn_percent";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_budget_allocation_campaign_check", DROP CONSTRAINT IF EXISTS "expenses_budget_allocation_id_fkey", DROP COLUMN IF EXISTS "budget_allocation_id";
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_budget_allocation_campaign_check", DROP CONSTRAINT IF EXISTS "purchase_orders_budget_allocation_id_fkey", DROP CONSTRAINT IF EXISTS "purchase_orders_campaign_id_fkey", DROP COLUMN IF EXISTS "budget_allocation_id", DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_budget_allocation_campaign_check", DROP CONSTRAINT IF EXISTS "purchase_invoices_budget_allocation_id_fkey", DROP CONSTRAINT IF EXISTS "purchase_invoices_campaign_id_fkey", DROP COLUMN IF EXISTS "budget_allocation_id", DROP COLUMN IF EXISTS "campaign_id";
DROP TABLE IF EXISTS "marketing_budget_alerts";
DROP TABLE IF EXISTS "marketing_budget_allocations";
DELETE FROM "marketing_campaign_lookups" WHERE "kind" = 'SPEND_CATEGORY';
ALTER TABLE "quotation_revisions" DROP COLUMN IF EXISTS "promotion_codes";
DROP TABLE IF EXISTS "marketing_promotion_redemptions";
ALTER TABLE IF EXISTS "marketing_promotions" DROP CONSTRAINT IF EXISTS "marketing_promotions_approved_version_id_fkey";
DROP TABLE IF EXISTS "marketing_promotion_versions";
DROP TABLE IF EXISTS "marketing_promotions";
DROP FUNCTION IF EXISTS marketing_promotion_version_frozen();
DROP FUNCTION IF EXISTS marketing_redemption_forward();
