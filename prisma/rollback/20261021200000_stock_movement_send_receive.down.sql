-- Rollback for 20261021200000_stock_movement_send_receive.
-- WARNING: a transfer still IN_TRANSIT has only its source side posted.
-- Receive (or reverse) every in-transit transfer before rolling back, or its
-- stock stays out of both warehouses:
--   SELECT movement_number FROM stock_movements WHERE status = 'IN_TRANSIT';
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_received_by_user_id_fkey";
DROP INDEX IF EXISTS "stock_movements_company_id_status_idx";
ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "received_at",
  DROP COLUMN IF EXISTS "received_by_user_id";
DROP TYPE IF EXISTS "StockMovementStatus";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021200000_stock_movement_send_receive';
