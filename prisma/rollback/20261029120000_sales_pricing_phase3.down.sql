-- Rollback for 20261029120000_sales_pricing_phase3. Run before the S4 down script.
-- Loses price lists, discount rules, pricing history and the per-line price
-- source / snapshot on quotations (unit prices and totals stay as stored).
BEGIN;
DROP TABLE IF EXISTS "pricing_events";
DROP TABLE IF EXISTS "discount_rules";
DROP TABLE IF EXISTS "price_list_entries";
DROP TABLE IF EXISTS "price_list_versions";
DROP TABLE IF EXISTS "price_lists";
ALTER TABLE "quotation_lines"
    DROP COLUMN IF EXISTS "price_source",
    DROP COLUMN IF EXISTS "list_unit_price",
    DROP COLUMN IF EXISTS "rule_discount_amount",
    DROP COLUMN IF EXISTS "calculated_unit_price",
    DROP COLUMN IF EXISTS "price_override_reason",
    DROP COLUMN IF EXISTS "pricing";
ALTER TABLE "sales_marketing_settings"
    DROP CONSTRAINT IF EXISTS "sales_marketing_settings_pricing_cap_check",
    DROP COLUMN IF EXISTS "pricing_max_rule_discount_percent";
DROP TYPE IF EXISTS "QuotationPriceSource";
DROP TYPE IF EXISTS "PriceListKind";
DROP TYPE IF EXISTS "PriceListVersionStatus";
DROP TYPE IF EXISTS "DiscountRuleStatus";
DROP TYPE IF EXISTS "DiscountRuleType";
DROP TYPE IF EXISTS "DiscountStacking";
DELETE FROM "permissions" WHERE "module" = 'sales_pricing';
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" = 'sales_quotations.override')
  AND "role_id" IN (SELECT "id" FROM "roles" WHERE "is_system_role" AND "name" IN ('MANAGEMENT', 'MERCHANDISER'));
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261029120000_sales_pricing_phase3';
COMMIT;
