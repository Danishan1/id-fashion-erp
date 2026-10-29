-- Rollback for 20261029090000_sales_quotation_conversion_s4. Run before the S3 down script.
-- Orders created from quotations stay; only their link to the quotation is
-- dropped. Quotations already CONVERTED keep that status.
BEGIN;
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_source_quotation_revision_id_fkey";
DROP INDEX IF EXISTS "sales_orders_source_quotation_revision_id_key";
ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "source_quotation_revision_id";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261029090000_sales_quotation_conversion_s4';
COMMIT;
