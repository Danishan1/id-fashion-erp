-- A dispatch pick line may take finished goods that are at the warehouse but not
-- yet put away to a location (warehouse_location_id null = staging).

-- AlterTable
ALTER TABLE "finished_goods_pick_lines" ALTER COLUMN "warehouse_location_id" DROP NOT NULL;

