-- Rollback for 20261022130000_fg_receive_step
-- Refuses to run while customer-return receipts (no lot) exist: those rows
-- can't satisfy the restored NOT NULL columns.
DROP TABLE IF EXISTS "finished_goods_receipt_postings";
ALTER TABLE "finished_goods_receipt_items" DROP COLUMN IF EXISTS "received_quantity", DROP COLUMN IF EXISTS "suggested_location_id", ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "finished_goods_receipts" DROP CONSTRAINT IF EXISTS "finished_goods_receipts_dispatch_id_fkey", DROP CONSTRAINT IF EXISTS "finished_goods_receipts_dispatch_return_id_fkey";
ALTER TABLE "finished_goods_receipts" DROP COLUMN IF EXISTS "dispatch_id", DROP COLUMN IF EXISTS "dispatch_return_id", DROP COLUMN IF EXISTS "received_at", DROP COLUMN IF EXISTS "remarks", DROP COLUMN IF EXISTS "source", DROP COLUMN IF EXISTS "status",
  ALTER COLUMN "lot_id" SET NOT NULL, ALTER COLUMN "job_order_id" SET NOT NULL, ALTER COLUMN "production_order_id" SET NOT NULL;
DROP TYPE IF EXISTS "FinishedGoodsReceiptSource";
DROP TYPE IF EXISTS "FinishedGoodsReceiptStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261022130000_fg_receive_step';
