-- Rollback for 20261103090000_sales_performance_phase5. Run before the Phase 03 down script.
-- Loses territories, rep assignments, customer territories, targets and their
-- revisions, the performance activity log and the stored sales credit on
-- Sales Orders (orders themselves are untouched).
BEGIN;
DROP INDEX IF EXISTS "sales_orders_company_id_sales_rep_user_id_order_date_idx";
DROP INDEX IF EXISTS "sales_orders_company_id_sales_territory_id_order_date_idx";
ALTER TABLE "sales_orders"
    DROP CONSTRAINT IF EXISTS "sales_orders_sales_rep_user_id_fkey",
    DROP CONSTRAINT IF EXISTS "sales_orders_sales_territory_id_fkey",
    DROP CONSTRAINT IF EXISTS "sales_orders_sales_credit_changed_by_id_fkey",
    DROP COLUMN IF EXISTS "sales_rep_user_id",
    DROP COLUMN IF EXISTS "sales_territory_id",
    DROP COLUMN IF EXISTS "sales_credit_source",
    DROP COLUMN IF EXISTS "sales_credit_changed_at",
    DROP COLUMN IF EXISTS "sales_credit_changed_by_id",
    DROP COLUMN IF EXISTS "sales_credit_reason";
ALTER TABLE "customers"
    DROP CONSTRAINT IF EXISTS "customers_sales_territory_id_fkey",
    DROP COLUMN IF EXISTS "sales_territory_id";
DROP TABLE IF EXISTS "sales_performance_events";
DROP TABLE IF EXISTS "sales_target_revisions";
DROP TABLE IF EXISTS "sales_targets";
DROP TABLE IF EXISTS "sales_territory_assignments";
DROP TABLE IF EXISTS "sales_territories";
DROP TYPE IF EXISTS "SalesTargetScope";
DROP TYPE IF EXISTS "SalesTargetMetric";
DROP TYPE IF EXISTS "SalesTargetPeriodType";
DROP TYPE IF EXISTS "SalesTargetRevisionStatus";
DROP TYPE IF EXISTS "SalesCreditSource";
DELETE FROM "permissions" WHERE "module" = 'sales_performance';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103090000_sales_performance_phase5';
COMMIT;
