-- Rollback for 20261021220000_colour_wise_raw_material_stock.
-- Drops colour-wise stock tracking. Warehouse totals (stock_balances) are
-- untouched; only the colour attribution of stock is lost.
ALTER TABLE "stock_movement_items" DROP CONSTRAINT IF EXISTS "stock_movement_items_color_id_fkey";
ALTER TABLE "inventory_transactions" DROP CONSTRAINT IF EXISTS "inventory_transactions_color_id_fkey";
ALTER TABLE "material_substitutions" DROP CONSTRAINT IF EXISTS "material_substitutions_substitute_color_id_fkey";
DROP TABLE IF EXISTS "stock_color_balances";
ALTER TABLE "stock_movement_items" DROP COLUMN IF EXISTS "color_id";
ALTER TABLE "inventory_transactions" DROP COLUMN IF EXISTS "color_id";
ALTER TABLE "material_substitutions" DROP COLUMN IF EXISTS "substitute_color_id";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021220000_colour_wise_raw_material_stock';
