-- Rollback for 20261104090000_sales_commissions_phase7. Run before the Phase 06 down script.
-- Loses channels, channel / agent on enquiries, quotations and orders, commission
-- plans, assignments, statements and incentive plans. Payment requests already
-- raised for commission statements are kept, but their type value can't be
-- removed from the PaymentRequestType enum (Postgres can't drop an enum value);
-- it stays, unused, if no request uses it.
BEGIN;
DROP INDEX IF EXISTS "sales_orders_company_id_sales_channel_id_idx";
DROP TABLE IF EXISTS "sales_commission_lines";
DROP TABLE IF EXISTS "sales_commission_statements";
DROP TABLE IF EXISTS "sales_commission_assignments";
DROP TABLE IF EXISTS "sales_commission_plan_versions";
DROP TABLE IF EXISTS "sales_commission_plans";
DROP TABLE IF EXISTS "sales_incentive_plans";
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_sales_channel_id_fkey", DROP CONSTRAINT IF EXISTS "sales_orders_sales_agent_id_fkey", DROP COLUMN IF EXISTS "sales_channel_id", DROP COLUMN IF EXISTS "sales_agent_id";
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_sales_channel_id_fkey", DROP CONSTRAINT IF EXISTS "quotations_sales_agent_id_fkey", DROP COLUMN IF EXISTS "sales_channel_id", DROP COLUMN IF EXISTS "sales_agent_id";
ALTER TABLE "buyer_enquiries" DROP CONSTRAINT IF EXISTS "buyer_enquiries_sales_channel_id_fkey", DROP CONSTRAINT IF EXISTS "buyer_enquiries_sales_agent_id_fkey", DROP COLUMN IF EXISTS "sales_channel_id", DROP COLUMN IF EXISTS "sales_agent_id";
DROP TABLE IF EXISTS "sales_channels";
DROP TYPE IF EXISTS "SalesCommissionPayeeType";
DROP TYPE IF EXISTS "SalesCommissionBasis";
DROP TYPE IF EXISTS "SalesCommissionMethod";
DROP TYPE IF EXISTS "SalesCommissionTierMode";
DROP TYPE IF EXISTS "SalesCommissionVersionStatus";
DROP TYPE IF EXISTS "SalesCommissionStatementStatus";
DROP TYPE IF EXISTS "SalesCommissionLineKind";
DROP TYPE IF EXISTS "SalesIncentivePlanStatus";
DELETE FROM "permissions" WHERE "module" = 'sales_commissions';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104090000_sales_commissions_phase7';
COMMIT;
